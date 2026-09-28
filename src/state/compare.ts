/**
 * Orchestrates the car-vs-OV comparison. Start point, car route/cost and OV journeys are
 * independent resources: each loads, fails and retries on its own, so e.g. a failing OV planner
 * never hides the car cost.
 */
import { useState } from 'react';

import { calculateCarCost, type CarCost } from '../domain/carCost';
import { calculatePublicTransportCost, type FareQuote } from '../domain/fare/engine';
import { FARE_DATA_2026 } from '../domain/fare/tariffs';
import type { TimeQuery, TransitItinerary } from '../domain/transit';
import type { Place, Route } from '../domain/types';
import { reverseGeocode } from '../services/geocoding';
import { isAppError } from '../services/http';
import { getPosition } from '../services/location';
import type { ResolvedPrice } from '../services/priceService';
import { getRoute, NoRouteError } from '../services/routing';
import { availableTransitProviders, withTransitProvider } from '../services/transit/registry';
import type { PublicTransportProvider } from '../services/transit/types';
import { useAsyncResource, useFuelPrice } from './hooks';
import { type StartMode, useApp } from './store';

export type Failure = { kind: 'no-route' | 'location' | 'offline' | 'failed' | 'unavailable'; message: string };

export class FailureError extends Error {
  constructor(public readonly failure: Failure) {
    super(failure.message);
  }
}

export function toFailure(e: unknown, what: string): Failure {
  if (e instanceof FailureError) return e.failure;
  if (e instanceof NoRouteError) return { kind: 'no-route', message: 'Er is geen route over de weg naar deze bestemming.' };
  if (isAppError(e) && e.kind === 'offline') return { kind: 'offline', message: 'Geen internetverbinding.' };
  if (isAppError(e) && e.kind === 'rate-limit') return { kind: 'failed', message: 'Even te veel aanvragen. Probeer het zo opnieuw.' };
  return { kind: 'failed', message: `${what} lukt nu niet.` };
}

export interface StartPoint {
  lat: number;
  lon: number;
  label: string;
  fromDevice: boolean;
}

/** Resolves where the trip starts. Device position lives only in memory. */
async function loadStart(startMode: StartMode, manualStart: Place | null): Promise<StartPoint> {
  if (startMode === 'device') {
    const pos = await getPosition();
    if (pos.status !== 'ok') throw new FailureError({ kind: 'location', message: 'We konden je huidige locatie niet bepalen.' });
    return { lat: pos.lat, lon: pos.lon, label: 'Huidige locatie', fromDevice: true };
  }
  if (manualStart) return { lat: manualStart.lat, lon: manualStart.lon, label: manualStart.label, fromDevice: false };
  throw new FailureError({ kind: 'location', message: 'Kies eerst een vertrekpunt.' });
}

export function useStartPoint(attempt: number) {
  const startMode = useApp((s) => s.startMode);
  const manualStart = useApp((s) => s.manualStart);
  const start = useAsyncResource(`${startMode}|${manualStart?.id ?? ''}|${attempt}`, () => loadStart(startMode, manualStart));
  // Name the GPS start ("Huidige locatie · Heerlen"). Coarse position; purely cosmetic.
  const lat = start.status === 'ok' && start.data.fromDevice ? start.data.lat : 0;
  const lon = start.status === 'ok' && start.data.fromDevice ? start.data.lon : 0;
  const place = useAsyncResource(lat ? `${lat.toFixed(2)},${lon.toFixed(2)}` : null, (signal) => reverseGeocode(lat, lon, { signal }));
  const label =
    start.status === 'ok'
      ? place.status === 'ok' && place.data
        ? `${start.data.label} · ${place.data.label}`
        : start.data.label
      : '';
  return { start, label };
}

const coordKey = (p: { lat: number; lon: number } | null) => (p ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : '');

// ---- Car --------------------------------------------------------------------------------

export type CarState =
  | { status: 'loading' }
  | { status: 'error'; failure: Failure }
  | { status: 'needs-price'; route: Route }
  | { status: 'ok'; route: Route; cost: CarCost; price: ResolvedPrice; stale: boolean };

export function useCarComparison(
  from: StartPoint | null,
  to: Place | null,
  attempt: number,
  tripPrice: ResolvedPrice | null,
): CarState & { reloadPrice: () => void } {
  const vehicle = useApp((s) => s.vehicle);
  const price = useFuelPrice();
  const fromLat = from?.lat ?? 0;
  const fromLon = from?.lon ?? 0;
  const toLat = to?.lat ?? 0;
  const toLon = to?.lon ?? 0;
  const route = useAsyncResource(from && to ? `${coordKey(from)}>${coordKey(to)}|${attempt}` : null, (signal) =>
    getRoute({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }, { signal }),
  );
  const reloadPrice = price.reload;

  if (route.status === 'error') return { status: 'error', failure: toFailure(route.error, 'De autoroute berekenen'), reloadPrice };
  if (route.status !== 'ok' || price.status === 'loading' || !vehicle?.consumption) return { status: 'loading', reloadPrice };

  const resolved = price.status === 'ready' ? price.resolved : tripPrice;
  if (!resolved) return { status: 'needs-price', route: route.data, reloadPrice };
  try {
    const cost = calculateCarCost({
      distanceKm: route.data.distanceKm,
      consumptionPer100Km: vehicle.consumption.value,
      pricePerUnit: resolved.price.pricePerUnit,
      electric: vehicle.pricedFuel === 'electricity',
    });
    return { status: 'ok', route: route.data, cost, price: resolved, stale: price.status === 'ready' && price.stale, reloadPrice };
  } catch {
    return {
      status: 'error',
      failure: { kind: 'failed', message: 'Deze rit is te lang of de gegevens kloppen niet.' },
      reloadPrice,
    };
  }
}

// ---- OV ---------------------------------------------------------------------------------

export interface PricedItinerary {
  itinerary: TransitItinerary;
  fare: FareQuote;
}

export type TransitState =
  | { status: 'loading' }
  | { status: 'error'; failure: Failure }
  | { status: 'ok'; options: PricedItinerary[]; provider: PublicTransportProvider };

async function loadTransit(from: { lat: number; lon: number }, to: { lat: number; lon: number }, time: TimeQuery, signal: AbortSignal) {
  if (!availableTransitProviders().length) {
    throw new FailureError({ kind: 'unavailable', message: 'Er is geen OV-planner beschikbaar in deze versie.' });
  }
  return withTransitProvider((p) => p.plan(from, to, time, { signal }));
}

export function useTransitComparison(from: StartPoint | null, to: Place | null, attempt: number): TransitState {
  const time = useApp((s) => s.timeQuery);
  const profile = useApp((s) => s.transitProfile);
  // "Now" is pinned to when the screen opened; retry (attempt) plans again from the new now.
  const [openedAt] = useState(() => Date.now());
  const timeKey = time.kind === 'now' ? `now:${openedAt}` : `${time.kind}:${time.at}`;
  const fromLat = from?.lat ?? 0;
  const fromLon = from?.lon ?? 0;
  const toLat = to?.lat ?? 0;
  const toLon = to?.lon ?? 0;
  const res = useAsyncResource(from && to ? `${coordKey(from)}>${coordKey(to)}|${timeKey}|${attempt}` : null, (signal) =>
    loadTransit({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }, time, signal),
  );

  if (res.status === 'error') return { status: 'error', failure: toFailure(res.error, 'OV-reizen zoeken') };
  if (res.status !== 'ok') return { status: 'loading' };
  const options = res.data.result.itineraries
    // A "trip" that is only walking isn't an OV option.
    .filter((it) => it.legs.some((l) => l.mode !== 'walk'))
    .map((itinerary) => ({ itinerary, fare: calculatePublicTransportCost(itinerary, profile, FARE_DATA_2026) }));
  if (!options.length) {
    return { status: 'error', failure: { kind: 'no-route', message: 'Er rijdt op dit tijdstip geen openbaar vervoer naar deze bestemming.' } };
  }
  return { status: 'ok', options, provider: res.data.provider };
}
