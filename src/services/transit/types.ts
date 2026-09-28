import type { TimeQuery, TransitItinerary } from '../../domain/transit';

export interface LatLon {
  lat: number;
  lon: number;
}

export type Availability =
  | { status: 'available' }
  | { status: 'unavailable'; reason: 'no-licence' | 'no-proxy' | 'disabled'; message: string };

export interface TransitCapabilities {
  realtime: boolean;
  /** Provider returns official ticket prices. */
  fares: boolean;
  doorToDoor: boolean;
}

export interface PlanResult {
  itineraries: TransitItinerary[];
  /** Cursor for "later" options, when supported. */
  nextCursor?: string;
}

export interface PublicTransportProvider {
  id: string;
  label: string;
  /** Shown near results (licence/attribution obligations). */
  attribution: { text: string; url: string };
  capabilities: TransitCapabilities;
  availability(): Availability;
  plan(from: LatLon, to: LatLon, time: TimeQuery, opts?: { signal?: AbortSignal; cursor?: string }): Promise<PlanResult>;
}
