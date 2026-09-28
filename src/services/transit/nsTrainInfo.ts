/**
 * NS train details for a ride in a journey (crowding, rolling stock, seats, facilities, notes),
 * via our proxy (/ns/train) which holds the NS key. Available only when EXPO_PUBLIC_API_BASE_URL is set.
 */
import { nearestStationCode } from '../../domain/fare/tariffUnits';
import type { Leg } from '../../domain/transit';
import { cached } from '../cache';
import { fetchJson } from '../http';
import { apiBaseUrl } from './ns';

export type Crowd = 'LOW' | 'MEDIUM' | 'HIGH';

export interface NsTrainInfo {
  ritnummer: string;
  category?: string;
  trainType?: string;
  parts?: number;
  lengthM?: number;
  seats?: number;
  seatsFirst?: number;
  seatsSecond?: number;
  bikeSpots?: number;
  facilities: string[];
  crowd?: Crowd;
  shortened?: boolean;
  doubleDeck?: boolean;
  cancelled?: boolean;
  delayMin?: number;
  platformSections?: string;
  notes: string[];
}

export const nsTrainInfoAvailable = () => !!apiBaseUrl();

/** Only NS-operated trains with a known ride number have NS details. */
export function hasNsTrainInfo(leg: Leg): boolean {
  return leg.mode === 'train' && /(^|\b)ns(\b|$)/i.test(leg.operator ?? '') && !!leg.tripNumber && /^\d+$/.test(leg.tripNumber);
}

export async function fetchNsTrainInfo(leg: Leg, signal?: AbortSignal): Promise<NsTrainInfo> {
  const station = nearestStationCode(leg.from.lat, leg.from.lon) ?? '';
  const params = new URLSearchParams({ rit: leg.tripNumber ?? '', station, dateTime: leg.plannedDeparture });
  // Short cache: crowding and stock can change; also protects the NS rate limit (300 / 5 min).
  return cached(`ns-train:${leg.tripNumber}:${leg.plannedDeparture.slice(0, 10)}:${station}`, 60_000, () =>
    fetchJson<NsTrainInfo>(`${apiBaseUrl()}/ns/train?${params}`, { provider: 'ns', timeoutMs: 10_000, retries: 1, signal }),
  );
}
