/**
 * Driving distance + time. Keyless fallback chain (all OSM-based, CORS enabled):
 *   1. FOSSGIS Valhalla (valhalla1.openstreetmap.de) — most realistic drive times
 *      (FOSSGIS OSRM overestimates, e.g. 2 u 53 vs ~2 u 25 for Heerlen → Amsterdam)
 *   2. FOSSGIS OSRM (routing.openstreetmap.de/routed-car)
 *   3. OSRM demo server (router.project-osrm.org)
 * Optional: OpenRouteService when EXPO_PUBLIC_ORS_API_KEY is set (see README for the
 * trade-off of shipping a key in a client bundle; production should proxy it).
 *
 * We route once per destination — never while typing — to respect fair-use policies.
 */
import type { Route } from '../domain/types';
import { AppError, fetchJson, isAbort, type FetchJsonOptions } from './http';

type HttpOpts = Pick<FetchJsonOptions, 'fetchFn' | 'signal' | 'sleep'>;
export interface LatLon {
  lat: number;
  lon: number;
}

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number }[];
  waypoints?: { distance?: number }[];
}

/**
 * OSRM happily "snaps" a point in the sea to a road 100+ km away and returns code "Ok".
 * A start or destination this far from any road means there is no real driving route.
 */
export const MAX_SNAP_DISTANCE_M = 2000;
interface ValhallaResponse {
  trip?: { summary: { length: number; time: number } };
}
interface OrsResponse {
  routes?: { summary: { distance: number; duration: number } }[];
}

export class NoRouteError extends AppError {
  constructor(provider: string) {
    super('not-found', `${provider}: no route between these points`, provider);
    this.name = 'NoRouteError';
  }
}

const coord = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;
const km = (m: number) => Math.round(m / 100) / 10;

async function osrm(base: string, source: Route['source'], a: LatLon, b: LatLon, http: HttpOpts): Promise<Route> {
  const url = `${base}/route/v1/driving/${coord(a)};${coord(b)}?overview=false&alternatives=false&steps=false`;
  const data = await fetchJson<OsrmResponse>(url, { provider: source, timeoutMs: 8000, retries: 1, ...http });
  if (data.code === 'NoRoute' || data.code === 'NoSegment') throw new NoRouteError(source);
  if (data.waypoints?.some((w) => (w.distance ?? 0) > MAX_SNAP_DISTANCE_M)) throw new NoRouteError(source);
  const r = data.routes?.[0];
  if (data.code !== 'Ok' || !r || !Number.isFinite(r.distance)) {
    throw new AppError('provider', `${source}: unexpected response (${data.code})`, source);
  }
  return { distanceKm: km(r.distance), durationMin: Math.round(r.duration / 60), source };
}

async function valhalla(a: LatLon, b: LatLon, http: HttpOpts): Promise<Route> {
  const body = {
    locations: [
      { lat: a.lat, lon: a.lon },
      { lat: b.lat, lon: b.lon },
    ],
    costing: 'auto',
    units: 'kilometers',
    directions_type: 'none',
  };
  const url = `https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`;
  const data = await fetchJson<ValhallaResponse>(url, { provider: 'fossgis-valhalla', timeoutMs: 8000, retries: 0, ...http });
  const s = data.trip?.summary;
  if (!s || !Number.isFinite(s.length)) throw new AppError('provider', 'valhalla: unexpected response', 'fossgis-valhalla');
  return { distanceKm: Math.round(s.length * 10) / 10, durationMin: Math.round(s.time / 60), source: 'fossgis-valhalla' };
}

async function ors(key: string, a: LatLon, b: LatLon, http: HttpOpts): Promise<Route> {
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?start=${coord(a)}&end=${coord(b)}`;
  const data = await fetchJson<OrsResponse & { features?: { properties: { summary: { distance: number; duration: number } } }[] }>(
    url,
    { provider: 'ors', timeoutMs: 8000, retries: 0, headers: { Authorization: key }, ...http },
  );
  const s = data.features?.[0]?.properties.summary ?? data.routes?.[0]?.summary;
  if (!s) throw new AppError('provider', 'ors: unexpected response', 'ors');
  return { distanceKm: km(s.distance), durationMin: Math.round(s.duration / 60), source: 'ors' };
}

type Router = (a: LatLon, b: LatLon, http: HttpOpts) => Promise<Route>;

export function buildRouterChain(orsKey = process.env.EXPO_PUBLIC_ORS_API_KEY): Router[] {
  const chain: Router[] = [
    valhalla,
    (a, b, h) => osrm('https://routing.openstreetmap.de/routed-car', 'fossgis-osrm', a, b, h),
    (a, b, h) => osrm('https://router.project-osrm.org', 'osrm-demo', a, b, h),
  ];
  if (orsKey) chain.push((a, b, h) => ors(orsKey, a, b, h));
  return chain;
}

/**
 * Try each router in turn. A definitive "no route" (e.g. across the sea) stops the chain;
 * network/provider errors fall through to the next router.
 */
export async function getRoute(a: LatLon, b: LatLon, http: HttpOpts = {}, chain = buildRouterChain()): Promise<Route> {
  let lastError: unknown;
  for (const router of chain) {
    try {
      return await router(a, b, http);
    } catch (e) {
      if (isAbort(e) || e instanceof NoRouteError) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new AppError('provider', 'routing: no providers', 'routing');
}
