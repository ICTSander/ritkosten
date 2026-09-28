/**
 * Public transport domain. Provider-agnostic: NS, Transitous, 9292… all map into these types,
 * so the UI never depends on a specific API.
 */

export type LegMode = 'walk' | 'bus' | 'tram' | 'metro' | 'train' | 'ferry' | 'other';

export interface Stop {
  name: string;
  lat: number;
  lon: number;
  /** Actual platform/track when known (realtime), else planned. */
  platform?: string;
  plannedPlatform?: string;
}

export interface Leg {
  mode: LegMode;
  /** Line name as shown to travellers: "44", "IC", "Sprinter", "M52". */
  line?: string;
  /** Longer service name, e.g. "Intercity" or "Arriva Trein". */
  lineLong?: string;
  operator?: string;
  /** Direction shown on the vehicle. */
  headsign?: string;
  /** Route colour from the operator feed (hex without #), when provided. */
  color?: string;
  from: Stop;
  to: Stop;
  plannedDeparture: string; // ISO
  plannedArrival: string; // ISO
  /** Realtime estimates when the provider has them. */
  departure: string; // ISO, realtime if available else planned
  arrival: string; // ISO
  realtime: boolean;
  /** Positive = late. Only set when realtime data exists. */
  delayMin?: number;
  cancelled: boolean;
  distanceMeters?: number;
  durationMin: number;
  intermediateStops: number;
  /** Train number, when known — used for vehicle details. */
  tripNumber?: string;
}

export interface TransitItinerary {
  id: string;
  providerId: string;
  legs: Leg[];
  departure: string; // ISO (first leg)
  arrival: string; // ISO (last leg)
  durationMin: number;
  /** Number of vehicle changes (vehicle legs − 1). */
  transfers: number;
  realtime: boolean;
  /** Full fare from the provider in cents (NS), when available. */
  apiFullFareCents?: number;
}

export type TimeQuery =
  | { kind: 'now' }
  | { kind: 'depart'; at: string } // ISO
  | { kind: 'arrive'; at: string }; // ISO

export interface TransitFilters {
  modes: LegMode[]; // allowed vehicle modes; walk always allowed
}

export const ALL_TRANSIT_MODES: LegMode[] = ['train', 'bus', 'tram', 'metro', 'ferry'];

export const vehicleLegs = (it: Pick<TransitItinerary, 'legs'>) => it.legs.filter((l) => l.mode !== 'walk');

export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
}

/** Sort helpers for the compact filters. */
export type TransitSort = 'departure' | 'fastest' | 'fewest-transfers';

export function sortItineraries(list: TransitItinerary[], sort: TransitSort): TransitItinerary[] {
  const copy = [...list];
  if (sort === 'fastest') copy.sort((a, b) => a.durationMin - b.durationMin || Date.parse(a.departure) - Date.parse(b.departure));
  else if (sort === 'fewest-transfers') copy.sort((a, b) => a.transfers - b.transfers || a.durationMin - b.durationMin);
  else copy.sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure));
  return copy;
}

/** Keep itineraries whose vehicle legs all use allowed modes. */
export function filterItineraries(list: TransitItinerary[], filters: TransitFilters): TransitItinerary[] {
  const allowed = new Set<LegMode>(filters.modes);
  return list.filter((it) => vehicleLegs(it).every((l) => allowed.has(l.mode) || l.mode === 'other'));
}
