import { lineColors } from '../../ui/transit';
import { buildGoogleMapsDirectionsUrl } from '../maps';
import { AppError } from '../http';
import { ninetwoninetwo } from '../transit/ninetwoninetwo';
import { nsProxy } from '../transit/ns';
import { decodePolyline, polylineLengthM } from '../transit/polyline';
import { allTransitProviders, withTransitProvider } from '../transit/registry';
import { hasNsTrainInfo } from '../transit/nsTrainInfo';
import { mapMotisItinerary, mapMotisMode, transitous } from '../transit/transitous';
import type { PublicTransportProvider } from '../transit/types';
import fixture from './fixtures/transitous-heerlen-amsterdam.json';
import { fakeFetch } from './helpers';

describe('polyline', () => {
  it('decodes Google polylines (precision 5 reference example)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('measures length', () => {
    // 1° of latitude ≈ 111.2 km
    expect(polylineLengthM([[52, 5], [53, 5]]) / 1000).toBeCloseTo(111.2, 0);
  });
});

describe('Transitous mapping (real recorded response)', () => {
  const [direct, viaSittard] = fixture.itineraries.map((it, i) => mapMotisItinerary(it as never, i));

  it('maps modes', () => {
    expect(mapMotisMode('REGIONAL_RAIL')).toBe('train');
    expect(mapMotisMode('SUBWAY')).toBe('metro');
    expect(mapMotisMode('WALK')).toBe('walk');
    expect(mapMotisMode('SOMETHING_NEW')).toBe('other');
  });

  it('builds a door-to-door itinerary', () => {
    expect(direct.legs.map((l) => l.mode)).toEqual(['walk', 'train', 'walk']);
    expect(direct).toMatchObject({ transfers: 0, durationMin: 162, providerId: 'transitous' });
    const train = direct.legs[1];
    expect(train).toMatchObject({ line: 'Intercity', operator: 'NS', headsign: 'Enkhuizen', tripNumber: '3936' });
    expect(train.from).toMatchObject({ name: 'Heerlen', platform: '5' });
    expect(train.to.name).toBe('Amsterdam Centraal');
  });

  it('cleans START/END placeholders and derives vehicle distance from the geometry', () => {
    expect(direct.legs[0].from.name).toBe('');
    expect(direct.legs[0].distanceMeters).toBe(609);
    const km = (direct.legs[1].distanceMeters ?? 0) / 1000;
    expect(km).toBeGreaterThan(200);
    expect(km).toBeLessThan(230);
  });

  it('keeps transfers via another operator', () => {
    expect(viaSittard.transfers).toBe(1);
    expect(viaSittard.legs.filter((l) => l.mode === 'train').map((l) => l.operator)).toEqual(['Arriva', 'NS']);
  });

  it('calls the plan endpoint with coordinates and arriveBy', async () => {
    const { fetchFn, calls } = fakeFetch(fixture);
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(fetchFn);
    const r = await transitous.plan({ lat: 50.8882, lon: 5.9795 }, { lat: 52.3791, lon: 4.9003 }, { kind: 'arrive', at: '2026-09-29T09:00:00.000Z' });
    spy.mockRestore();
    expect(decodeURIComponent(calls[0])).toContain('fromPlace=50.888200,5.979500');
    expect(calls[0]).toContain('arriveBy=true');
    expect(r.itineraries).toHaveLength(2);
    expect(r.nextCursor).toBeTruthy();
  });
});

describe('provider registry', () => {
  const ok = (id: string, result: unknown): PublicTransportProvider =>
    ({ id, availability: () => ({ status: 'available' }), plan: jest.fn().mockResolvedValue(result) }) as unknown as PublicTransportProvider;
  const failing = (id: string, err: unknown): PublicTransportProvider =>
    ({ id, availability: () => ({ status: 'available' }), plan: jest.fn().mockRejectedValue(err) }) as unknown as PublicTransportProvider;

  it('9292 reports licence required and never returns data', async () => {
    expect(ninetwoninetwo.availability()).toMatchObject({ status: 'unavailable', reason: 'no-licence' });
    await expect(ninetwoninetwo.plan({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { kind: 'now' })).rejects.toBeInstanceOf(AppError);
  });

  it('never plans with NS (free keys cannot plan door-to-door)', () => {
    expect(allTransitProviders().map((p) => p.id)).toEqual(['9292', 'transitous']);
  });

  it('trains with a ride number get NS train info', () => {
    const base = { mode: 'train', operator: 'NS', tripNumber: '3964' } as never;
    expect(hasNsTrainInfo(base)).toBe(true);
    expect(hasNsTrainInfo({ ...(base as object), operator: 'Arriva' } as never)).toBe(true); // NS data covers Arriva too
    expect(hasNsTrainInfo({ ...(base as object), mode: 'bus' } as never)).toBe(false);
    expect(hasNsTrainInfo({ ...(base as object), tripNumber: undefined } as never)).toBe(false);
  });

  it('NS is unavailable without a proxy URL', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(nsProxy.availability()).toMatchObject({ status: 'unavailable', reason: 'no-proxy' });
  });

  it('falls through provider errors but stops when offline', async () => {
    const res = await withTransitProvider((p) => p.plan({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { kind: 'now' }), [
      failing('a', new AppError('provider', 'down')),
      ok('b', 'result-b'),
    ]);
    expect(res).toMatchObject({ provider: { id: 'b' }, result: 'result-b' });

    const second = ok('b', 'x');
    await expect(
      withTransitProvider((p) => p.plan({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { kind: 'now' }), [failing('a', new AppError('offline', 'x')), second]),
    ).rejects.toMatchObject({ kind: 'offline' });
    expect(second.plan).not.toHaveBeenCalled();
  });
});

describe('Google Maps hand-off', () => {
  it('builds the official universal directions URL (origin = device location)', () => {
    const url = buildGoogleMapsDirectionsUrl({ destination: { lat: 52.3791, lon: 4.9003 } });
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=52.379100%2C4.900300&travelmode=driving&dir_action=navigate');
  });

  it('transit links do not start navigation', () => {
    const url = buildGoogleMapsDirectionsUrl({ destination: { lat: 52, lon: 5 }, mode: 'transit' });
    expect(url).toContain('travelmode=transit');
    expect(url).not.toContain('dir_action');
  });
});


describe('line colours', () => {
  const leg = (mode: string, color?: string, textColor?: string) => ({ mode, color, textColor }) as never;
  it('uses the official line colour for buses with readable text', () => {
    expect(lineColors(leg('bus', 'ff00ff'))).toEqual({ badge: '#ff00ff', text: '#FFFFFF' });
    expect(lineColors(leg('bus', '00becd'))).toEqual({ badge: '#00becd', text: '#111111' });
    expect(lineColors(leg('bus', 'ff00ff', '000000'))).toEqual({ badge: '#ff00ff', text: '#000000' }); // feed's own text colour
  });
  it('ignores trains, walking and invalid colours', () => {
    expect(lineColors(leg('train', 'ff0000'))).toBeUndefined();
    expect(lineColors(leg('bus', 'red'))).toBeUndefined();
    expect(lineColors(leg('bus'))).toBeUndefined();
  });
});
