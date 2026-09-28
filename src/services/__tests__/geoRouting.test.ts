import type { Place } from '../../domain/types';
import { mapPdokDoc, mapPhotonFeature, mergeResults, parseWktPoint, searchPlaces } from '../geocoding';
import { AppError } from '../http';
import { buildRouterChain, getRoute, NoRouteError } from '../routing';
import { fakeFetch } from './helpers';

const place = (p: Partial<Place>): Place => ({ id: p.label!, label: 'x', lat: 52, lon: 5, kind: 'address', source: 'pdok', ...p });

describe('geocoding mapping', () => {
  it('parses lon-first WKT points', () => {
    expect(parseWktPoint('POINT(4.89803846 52.37714446)')).toEqual({ lon: 4.89803846, lat: 52.37714446 });
    expect(parseWktPoint('garbage')).toBeNull();
    expect(parseWktPoint(undefined)).toBeNull();
  });

  it('maps PDOK addresses and drops duplicated place names', () => {
    expect(mapPdokDoc({ id: 'a', type: 'adres', weergavenaam: 'Damrak 1, 1012LG Amsterdam', centroide_ll: 'POINT(4.898 52.377)' })).toMatchObject({
      label: 'Damrak 1',
      detail: '1012LG Amsterdam',
      kind: 'address',
      countryCode: 'NL',
    });
    expect(mapPdokDoc({ id: 'b', type: 'woonplaats', weergavenaam: 'Maastricht, Maastricht, Limburg', centroide_ll: 'POINT(5.69 50.85)' })).toMatchObject({
      label: 'Maastricht',
      detail: 'Limburg',
      kind: 'city',
    });
    expect(mapPdokDoc({ id: 'c', type: 'adres', weergavenaam: 'x' })).toBeNull();
  });

  it('maps Photon POIs with a Dutch category', () => {
    const p = mapPhotonFeature({
      geometry: { coordinates: [4.885, 52.36] },
      properties: { osm_id: 1, osm_type: 'W', osm_key: 'tourism', osm_value: 'museum', name: 'Rijksmuseum', city: 'Amsterdam', countrycode: 'NL' },
    });
    expect(p).toMatchObject({ label: 'Rijksmuseum', detail: 'Museum · Amsterdam', kind: 'poi', lat: 52.36, lon: 4.885 });
  });

  it('treats Photon place=house as an address, not a city', () => {
    const p = mapPhotonFeature({ geometry: { coordinates: [4.89, 52.37] }, properties: { osm_key: 'place', osm_value: 'house', street: 'Damrak', housenumber: '46-1', city: 'Amsterdam' } });
    expect(p).toMatchObject({ label: 'Damrak 46-1', kind: 'address' });
  });

  it('skips boundaries and waterways from Photon', () => {
    expect(mapPhotonFeature({ geometry: { coordinates: [5, 52] }, properties: { osm_key: 'waterway', name: 'Amstel' } })).toBeNull();
  });
});

describe('mergeResults', () => {
  it('puts PDOK addresses first for queries with a house number', () => {
    const out = mergeResults('Damrak 1', [place({ label: 'Damrak 1', lat: 52.377 })], [place({ label: 'Hotel', source: 'photon', kind: 'poi', lat: 52.378 })]);
    expect(out.map((p) => p.label)).toEqual(['Damrak 1', 'Hotel']);
  });

  it('keeps neighbouring addresses with different names', () => {
    const out = mergeResults('Damrak', [place({ label: 'Damrak 1', lat: 52.3771 }), place({ label: 'Damrak 2', lat: 52.37718 })], []);
    expect(out.map((p) => p.label)).toEqual(['Damrak 1', 'Damrak 2']);
  });

  it('drops a Photon city that PDOK already returned', () => {
    const out = mergeResults(
      'Amsterdam',
      [place({ label: 'Amsterdam', kind: 'city', lat: 52.37, lon: 4.9 })],
      [place({ label: 'Amsterdam', kind: 'city', source: 'photon', lat: 52.372, lon: 4.893 }), place({ label: 'Rijksmuseum', kind: 'poi', source: 'photon', lat: 52.36, lon: 4.88 })],
    );
    expect(out.map((p) => p.label)).toEqual(['Amsterdam', 'Rijksmuseum']);
  });
});

describe('searchPlaces', () => {
  it('ignores 1-character queries without calling any API', async () => {
    const { fetchFn, calls } = fakeFetch();
    await expect(searchPlaces('a', { fetchFn })).resolves.toEqual({ places: [], failed: false });
    expect(calls).toHaveLength(0);
  });

  it('returns partial results when one provider fails', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.includes('pdok')) throw new TypeError('Network request failed');
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ features: [{ geometry: { coordinates: [4.885, 52.36] }, properties: { osm_key: 'tourism', osm_value: 'museum', name: 'Rijksmuseum', city: 'Amsterdam' } }] }),
      };
    }) as unknown as typeof fetch;
    const r = await searchPlaces('Rijksmuseum', { fetchFn });
    expect(r.failed).toBe(false);
    expect(r.places[0].label).toBe('Rijksmuseum');
  });

  it('reports failure when both providers fail', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(searchPlaces('Utrecht', { fetchFn })).resolves.toMatchObject({ failed: true, places: [] });
  });
});

describe('routing', () => {
  const a = { lat: 50.849, lon: 5.691 };
  const b = { lat: 52.3598, lon: 4.885 };

  it('converts OSRM metres to km with one decimal', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 400 }, { code: 'Ok', routes: [{ distance: 212_987, duration: 10_320 }] });
    const r = await getRoute(a, b, { fetchFn });
    expect(r).toEqual({ distanceKm: 213, durationMin: 172, source: 'fossgis-osrm' });
    expect(calls[1]).toContain('5.691000,50.849000;4.885000,52.359800'); // lon,lat order
  });

  it('uses Valhalla first (realistic drive times)', async () => {
    const { fetchFn } = fakeFetch({ trip: { summary: { length: 214.04, time: 8880 } } });
    const r = await getRoute(a, b, { fetchFn });
    expect(r).toEqual({ distanceKm: 214, durationMin: 148, source: 'fossgis-valhalla' });
  });

  it('treats a point snapped >2 km to a road (e.g. in the sea) as "no route"', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 400 }, { code: 'Ok', routes: [{ distance: 733_009, duration: 31_165 }], waypoints: [{ distance: 122_218 }, { distance: 12 }] });
    await expect(getRoute({ lat: 53.5, lon: 3 }, b, { fetchFn })).rejects.toBeInstanceOf(NoRouteError);
    expect(calls).toHaveLength(2);
  });

  it('stops the chain on a definitive "no route"', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 400 }, { code: 'NoRoute' });
    await expect(getRoute(a, b, { fetchFn })).rejects.toBeInstanceOf(NoRouteError);
    expect(calls).toHaveLength(2);
  });

  it('throws the last error when every router fails', async () => {
    const chain = [jest.fn().mockRejectedValue(new AppError('provider', 'x')), jest.fn().mockRejectedValue(new AppError('offline', 'y'))];
    await expect(getRoute(a, b, {}, chain)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('only adds OpenRouteService when a key is configured', () => {
    expect(buildRouterChain(undefined)).toHaveLength(3);
    expect(buildRouterChain('key')).toHaveLength(4);
  });
});
