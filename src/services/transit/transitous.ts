/**
 * Transitous (https://transitous.org) — community-run MOTIS journey planner on open GTFS data
 * (for NL: OpenOV/NDOV). Keyless, CORS enabled, door-to-door with walking legs and realtime.
 *
 * Policy (https://transitous.org/api/): free for open-source, NON-COMMERCIAL use; contact them
 * before heavy use; attribution link to https://transitous.org/sources/ required.
 * No fares — prices come from our fare engine.
 */
import type { Leg, LegMode, TimeQuery, TransitItinerary } from '../../domain/transit';
import { fetchJson } from '../http';
import { decodePolyline, polylineLengthM } from './polyline';
import type { LatLon, PlanResult, PublicTransportProvider } from './types';

const BASE = 'https://api.transitous.org/api/v5/plan';
const APP_USER_AGENT = `Ritkosten/0.2 (${process.env.EXPO_PUBLIC_APP_CONTACT || 'trip cost planner'})`;

interface MotisPlace {
  name: string;
  lat: number;
  lon: number;
  track?: string;
  scheduledTrack?: string;
}

export interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  startTime: string;
  endTime: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  duration: number;
  distance?: number;
  realTime?: boolean;
  cancelled?: boolean;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  agencyName?: string;
  headsign?: string;
  tripShortName?: string;
  routeColor?: string;
  intermediateStops?: unknown[];
  legGeometry?: { points: string; precision?: number };
}

export interface MotisItinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}

interface MotisPlanResponse {
  itineraries: MotisItinerary[];
  nextPageCursor?: string;
}

export function mapMotisMode(mode: string): LegMode {
  switch (mode) {
    case 'WALK':
      return 'walk';
    case 'BUS':
    case 'COACH':
      return 'bus';
    case 'TRAM':
    case 'CABLE_CAR':
      return 'tram';
    case 'SUBWAY':
    case 'METRO':
      return 'metro';
    case 'FERRY':
      return 'ferry';
    case 'RAIL':
    case 'REGIONAL_RAIL':
    case 'REGIONAL_FAST_RAIL':
    case 'HIGHSPEED_RAIL':
    case 'LONG_DISTANCE':
    case 'NIGHT_RAIL':
    case 'SUBURBAN':
      return 'train';
    default:
      return 'other';
  }
}

const minutes = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

export function mapMotisLeg(l: MotisLeg): Leg {
  const mode = mapMotisMode(l.mode);
  let distanceMeters = l.distance;
  if (distanceMeters === undefined && l.legGeometry?.points) {
    distanceMeters = Math.round(polylineLengthM(decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6)));
  }
  const plannedDeparture = l.scheduledStartTime ?? l.startTime;
  const plannedArrival = l.scheduledEndTime ?? l.endTime;
  const delay = l.realTime ? minutes(plannedDeparture, l.startTime) : undefined;
  const clean = (name: string) => (name === 'START' || name === 'END' ? '' : name);
  return {
    mode,
    line: mode === 'walk' ? undefined : (l.routeShortName ?? l.displayName ?? undefined),
    lineLong: l.routeLongName || undefined,
    operator: l.agencyName || undefined,
    headsign: l.headsign || undefined,
    color: l.routeColor || undefined,
    from: { name: clean(l.from.name), lat: l.from.lat, lon: l.from.lon, platform: l.from.track, plannedPlatform: l.from.scheduledTrack },
    to: { name: clean(l.to.name), lat: l.to.lat, lon: l.to.lon, platform: l.to.track, plannedPlatform: l.to.scheduledTrack },
    plannedDeparture,
    plannedArrival,
    departure: l.startTime,
    arrival: l.endTime,
    realtime: !!l.realTime,
    delayMin: delay !== undefined && delay !== 0 ? delay : undefined,
    cancelled: !!l.cancelled,
    distanceMeters,
    durationMin: Math.round(l.duration / 60),
    intermediateStops: l.intermediateStops?.length ?? 0,
    tripNumber: l.tripShortName || undefined,
  };
}

export function mapMotisItinerary(it: MotisItinerary, index: number): TransitItinerary {
  const legs = it.legs.map(mapMotisLeg);
  return {
    id: `transitous:${it.startTime}:${it.endTime}:${index}`,
    providerId: 'transitous',
    legs,
    departure: it.startTime,
    arrival: it.endTime,
    durationMin: Math.round(it.duration / 60),
    transfers: it.transfers,
    realtime: legs.some((l) => l.realtime),
  };
}

export const transitous: PublicTransportProvider = {
  id: 'transitous',
  label: 'Transitous',
  attribution: { text: 'OV-reisadvies: Transitous (open data)', url: 'https://transitous.org/sources/' },
  capabilities: { realtime: true, fares: false, doorToDoor: true },
  availability: () => ({ status: 'available' }),
  async plan(from: LatLon, to: LatLon, time: TimeQuery, opts = {}): Promise<PlanResult> {
    const params = new URLSearchParams({
      fromPlace: `${from.lat.toFixed(6)},${from.lon.toFixed(6)}`,
      toPlace: `${to.lat.toFixed(6)},${to.lon.toFixed(6)}`,
      time: time.kind === 'now' ? new Date().toISOString() : time.at,
      arriveBy: String(time.kind === 'arrive'),
    });
    if (opts.cursor) params.set('pageCursor', opts.cursor);
    const data = await fetchJson<MotisPlanResponse>(`${BASE}?${params}`, {
      provider: 'transitous',
      // Transitous asks clients to identify themselves (browsers send Referer instead; UA is ignored there).
      headers: { 'User-Agent': APP_USER_AGENT },
      timeoutMs: 15_000,
      retries: 1,
      signal: opts.signal,
    });
    return {
      itineraries: (data.itineraries ?? []).map(mapMotisItinerary),
      nextCursor: data.nextPageCursor,
    };
  },
};
