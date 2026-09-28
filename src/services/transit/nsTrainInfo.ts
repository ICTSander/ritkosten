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
  /** One entry per coupled unit; `image` is NS's side-view drawing (shows the NS logo — see README). */
  carriages?: { type?: string; image?: string; width?: number; height?: number }[];
  notes: string[];
}

export interface TrainPosition {
  rit: string;
  lat: number;
  lon: number;
  speedKmh: number;
  at: string;
}

export const nsTrainInfoAvailable = () => !!apiBaseUrl();

/**
 * Trains with a numeric ride number: NS's data also covers regional operators (Arriva, Keolis…),
 * checked 2026-09-28 with an Arriva Flirt in Limburg.
 */
export function hasNsTrainInfo(leg: Leg): boolean {
  return leg.mode === 'train' && !!leg.tripNumber && /^\d+$/.test(leg.tripNumber);
}

/** Live GPS position of a train (NS shares ~300 trains; refresh every ~15 s). */
export function fetchTrainPosition(rit: string, signal?: AbortSignal): Promise<TrainPosition> {
  return fetchJson<TrainPosition>(`${apiBaseUrl()}/ns/position?rit=${encodeURIComponent(rit)}`, {
    provider: 'ns',
    timeoutMs: 8_000,
    retries: 0,
    signal,
  });
}

export async function fetchNsTrainInfo(leg: Leg, signal?: AbortSignal): Promise<NsTrainInfo> {
  const station = nearestStationCode(leg.from.lat, leg.from.lon) ?? '';
  const params = new URLSearchParams({ rit: leg.tripNumber ?? '', station, dateTime: leg.plannedDeparture });
  // Short cache: crowding and stock can change; also protects the NS rate limit (300 / 5 min).
  return cached(`ns-train:${leg.tripNumber}:${leg.plannedDeparture.slice(0, 10)}:${station}`, 60_000, () =>
    fetchJson<NsTrainInfo>(`${apiBaseUrl()}/ns/train?${params}`, { provider: 'ns', timeoutMs: 10_000, retries: 1, signal }),
  );
}
