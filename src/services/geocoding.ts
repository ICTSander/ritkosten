/**
 * Destination search.
 * - PDOK Locatieserver (Dutch government, keyless, CORS): addresses, places, postcodes — very fast.
 * - Photon (komoot, OSM-based, keyless, CORS): POIs like "Rijksmuseum" and anything abroad.
 * Both are queried in parallel; results are merged and de-duplicated.
 * Nominatim is deliberately NOT used: its policy forbids autocomplete.
 */
import type { Place } from '../domain/types';
import { fetchJson, isAbort, type FetchJsonOptions } from './http';

type HttpOpts = Pick<FetchJsonOptions, 'fetchFn' | 'signal'>;

const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const PHOTON = 'https://photon.komoot.io';

interface PdokDoc {
  id: string;
  type: string;
  weergavenaam: string;
  centroide_ll?: string;
}
interface PdokResponse {
  response: { docs: PdokDoc[] };
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
  };
}
interface PhotonResponse {
  features: PhotonFeature[];
}

/** "POINT(4.898 52.377)" → { lon, lat } (WKT is lon-first). */
export function parseWktPoint(wkt: string | undefined): { lat: number; lon: number } | null {
  if (!wkt) return null;
  const m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(wkt);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

const PDOK_KIND: Record<string, Place['kind']> = {
  adres: 'address',
  woonplaats: 'city',
  postcode: 'postcode',
  weg: 'street',
};

export function mapPdokDoc(doc: PdokDoc): Place | null {
  const point = parseWktPoint(doc.centroide_ll);
  if (!point) return null;
  const kind = PDOK_KIND[doc.type] ?? 'address';
  // "Damrak 1, 1012LG Amsterdam" → label "Damrak 1", detail "1012LG Amsterdam"
  // For places: "Maastricht, Maastricht, Limburg" → drop the repeated municipality name.
  const [head, ...rest] = doc.weergavenaam.split(', ');
  const detailParts = rest.filter((part) => part !== head);
  return {
    id: `pdok:${doc.id}`,
    label: head,
    detail: detailParts.length ? detailParts.join(', ') : undefined,
    ...point,
    countryCode: 'NL',
    kind,
    source: 'pdok',
  };
}

const PHOTON_SKIP_KEYS = new Set(['boundary', 'waterway', 'landuse']);
const OSM_VALUE_NL: Record<string, string> = {
  museum: 'Museum',
  station: 'Station',
  restaurant: 'Restaurant',
  hotel: 'Hotel',
  attraction: 'Attractie',
  university: 'Universiteit',
  hospital: 'Ziekenhuis',
  stadium: 'Stadion',
  theatre: 'Theater',
  zoo: 'Dierentuin',
  theme_park: 'Pretpark',
  aerodrome: 'Luchthaven',
  city: 'Stad',
  town: 'Plaats',
  village: 'Dorp',
};

export function mapPhotonFeature(f: PhotonFeature): Place | null {
  const p = f.properties;
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (p.osm_key && PHOTON_SKIP_KEYS.has(p.osm_key)) return null;

  // Photon tags plain addresses as place=house; only real settlements count as a city.
  const isPlace = p.osm_key === 'place' && !['house', 'houses'].includes(p.osm_value ?? '');
  const streetLine = p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}` : undefined;
  const label = p.name ?? streetLine ?? p.city;
  if (!label) return null;

  const category = p.osm_value ? OSM_VALUE_NL[p.osm_value] : undefined;
  const where = [p.city && p.city !== label ? p.city : undefined, p.countrycode && p.countrycode !== 'NL' ? p.country : undefined]
    .filter(Boolean)
    .join(', ');
  const detail = [category, where || p.state].filter(Boolean).join(' · ') || undefined;

  return {
    id: `photon:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lon}`}`,
    label,
    detail,
    lat,
    lon,
    countryCode: p.countrycode,
    kind: isPlace
      ? 'city'
      : (p.osm_key === 'railway' && p.osm_value === 'station') || p.osm_value === 'train_station'
        ? 'station'
        : p.osm_key === 'highway'
          ? 'street'
          : p.name
            ? 'poi'
            : 'address',
    source: 'photon',
  };
}

/** Rough distance in metres, good enough for de-duplication. */
export function approxDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const kx = 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dx = (a.lon - b.lon) * kx;
  const dy = (a.lat - b.lat) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

const hasNumber = (q: string) => /\d/.test(q);

/**
 * Merge strategy: queries with a number (house number / postcode) → PDOK first.
 * Otherwise PDOK places first, then Photon POIs. Duplicates (same name within ~300 m,
 * or a city that PDOK already returned) are dropped.
 */
export function mergeResults(query: string, pdok: Place[], photon: Place[], limit = 8): Place[] {
  const out: Place[] = [];
  // Same name close together = same place. (Different names are kept even when adjacent:
  // "Damrak 1" and "Damrak 2" are ~10 m apart but are different destinations.)
  const isDuplicate = (p: Place) =>
    out.some(
      (o) =>
        o.label.toLowerCase() === p.label.toLowerCase() &&
        approxDistanceM(o, p) < (p.kind === 'city' || o.kind === 'city' ? 5000 : 300),
    );
  const push = (p: Place) => {
    if (out.length < limit && !isDuplicate(p)) out.push(p);
  };

  if (hasNumber(query)) {
    pdok.forEach(push);
    photon.forEach(push);
  } else {
    // Stations first when the query names one ("Amsterdam Centraal", "Utrecht CS", "station Sittard").
    const namesStation = /\b(station|centraal|cs|ns)\b/i.test(query) || query.trim().split(/\s+/).length > 1;
    if (namesStation) photon.filter((p) => p.kind === 'station').slice(0, 2).forEach(push);
    pdok.filter((p) => p.kind === 'city').forEach(push);
    photon.filter((p) => p.kind === 'poi' || p.kind === 'city').slice(0, 5).forEach(push);
    // Streets only when their own name matches (not just the town they are in).
    const q = query.toLowerCase();
    pdok.filter((p) => p.kind !== 'city' && (p.kind !== 'street' || p.label.toLowerCase().includes(q))).forEach(push);
    photon.forEach(push);
  }
  return out;
}

export async function searchPdok(query: string, http: HttpOpts = {}): Promise<Place[]> {
  const params = new URLSearchParams({
    q: query,
    rows: '6',
    fl: 'id,type,weergavenaam,centroide_ll',
    fq: 'type:(woonplaats OR adres OR postcode OR weg)',
  });
  const data = await fetchJson<PdokResponse>(`${PDOK}/suggest?${params}`, {
    provider: 'pdok',
    // PDOK is normally ~100 ms but occasionally stalls; fail fast and retry once.
    retries: 1,
    timeoutMs: 3500,
    ...http,
  });
  return (data.response?.docs ?? []).map(mapPdokDoc).filter((p): p is Place => p !== null);
}

export async function searchPhoton(
  query: string,
  bias: { lat: number; lon: number } | undefined,
  http: HttpOpts = {},
): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: '8', lang: 'default' });
  // Photon accepts repeated osm_tag filters. Keep railway STATIONS (important for OV trips),
  // but drop platforms/stop positions/bus stops that duplicate station and POI names.
  for (const tag of [
    '!railway:tram_stop',
    '!railway:platform',
    '!railway:stop',
    '!railway:halt',
    '!public_transport:platform',
    '!public_transport:stop_position',
    '!highway:bus_stop',
    '!amenity:bicycle_parking',
    '!amenity:parking',
  ]) {
    params.append('osm_tag', tag);
  }
  if (bias) {
    params.set('lat', bias.lat.toFixed(3));
    params.set('lon', bias.lon.toFixed(3));
  } else {
    // Centre of NL as a sensible default bias.
    params.set('lat', '52.1');
    params.set('lon', '5.3');
  }
  const data = await fetchJson<PhotonResponse>(`${PHOTON}/api/?${params}`, {
    provider: 'photon',
    retries: 0,
    timeoutMs: 6000,
    ...http,
  });
  return (data.features ?? []).map(mapPhotonFeature).filter((p): p is Place => p !== null);
}

export interface SearchOutcome {
  places: Place[];
  /** True when every provider failed (as opposed to "no matches"). */
  failed: boolean;
  error?: unknown;
}

export async function searchPlaces(
  query: string,
  opts: { bias?: { lat: number; lon: number } } & HttpOpts = {},
): Promise<SearchOutcome> {
  const q = query.trim();
  if (q.length < 2) return { places: [], failed: false };
  const { bias, ...http } = opts;

  const [pdok, photon] = await Promise.allSettled([searchPdok(q, http), searchPhoton(q, bias, http)]);
  const rejected = [pdok, photon].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  const aborted = rejected.find((r) => isAbort(r.reason));
  if (aborted) throw aborted.reason;

  const places = mergeResults(
    q,
    pdok.status === 'fulfilled' ? pdok.value : [],
    photon.status === 'fulfilled' ? photon.value : [],
  );
  return { places, failed: rejected.length === 2, error: rejected[0]?.reason };
}

/** Name the user's current position, e.g. "Heerlen", and get the country code. */
export async function reverseGeocode(
  lat: number,
  lon: number,
  http: HttpOpts = {},
): Promise<{ label: string; countryCode?: string } | null> {
  try {
    // Only a town name is needed, so send a coarse (~1 km) position, never the exact one.
    const params = new URLSearchParams({ lat: lat.toFixed(2), lon: lon.toFixed(2), lang: 'default', limit: '1' });
    const data = await fetchJson<PhotonResponse>(`${PHOTON}/reverse?${params}`, {
      provider: 'photon',
      retries: 0,
      timeoutMs: 5000,
      ...http,
    });
    const p = data.features?.[0]?.properties;
    if (!p) return null;
    const label = p.city ?? p.county ?? p.state ?? p.name;
    return label ? { label, countryCode: p.countrycode } : null;
  } catch (e) {
    if (isAbort(e)) throw e;
    return null; // purely cosmetic — never block the flow on this
  }
}
