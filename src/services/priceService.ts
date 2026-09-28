/**
 * Resolves the price to use for a trip:
 *   1. user-entered override (if the user set one)
 *   2. fresh cached provider price (< 6 h)
 *   3. live provider fetch
 *   4. last known provider price, any age (flagged as `fromCache`)
 *   5. nothing → UI asks the user for a price (never a hard-coded default)
 */
import type { CountryCode, FuelPrice, PricedFuel } from '../domain/types';
import { cacheGet, cacheSet, HOUR } from './cache';
import { type ChargingMode, providersFor } from './fuelPrices';
import { isAbort } from './http';

export interface ResolvedPrice {
  price: FuelPrice;
  /** Served from cache because the live source failed. */
  fromCache: boolean;
  /** When we last successfully fetched from the provider (ms epoch). */
  fetchedAtMs: number;
}

const FRESH_MS = 6 * HOUR;
const FOREVER = Number.MAX_SAFE_INTEGER;

const cacheKey = (country: CountryCode, fuel: PricedFuel, mode: ChargingMode) =>
  `price:${country}:${fuel}${fuel === 'electricity' ? `:${mode}` : ''}`;

export function userPrice(fuel: PricedFuel, value: number, now = new Date()): FuelPrice {
  return {
    fuel,
    pricePerUnit: value,
    unit: fuel === 'electricity' ? 'kWh' : 'L',
    currency: 'EUR',
    country: 'NL',
    observedAt: now.toISOString().slice(0, 10),
    fetchedAt: now.toISOString(),
    source: 'user',
    method: 'user-entered',
    methodLabel: 'Door jou ingevulde prijs',
  };
}

export async function resolvePrice(opts: {
  fuel: PricedFuel;
  chargingMode: ChargingMode;
  override?: number;
  country?: CountryCode;
  signal?: AbortSignal;
  forceRefresh?: boolean;
}): Promise<ResolvedPrice> {
  const { fuel, chargingMode, override, signal, forceRefresh } = opts;
  if (override !== undefined) {
    return { price: userPrice(fuel, override), fromCache: false, fetchedAtMs: Date.now() };
  }
  const country: CountryCode = opts.country ?? 'NL';
  const key = cacheKey(country, fuel, chargingMode);

  if (!forceRefresh) {
    const fresh = await cacheGet<FuelPrice>(key, FRESH_MS);
    if (fresh) return { price: fresh.value, fromCache: false, fetchedAtMs: Date.now() - fresh.ageMs };
  }

  let lastError: unknown;
  for (const provider of providersFor(country)) {
    try {
      const price = await provider.getPrice(fuel, { chargingMode, signal });
      await cacheSet(key, price);
      return { price, fromCache: false, fetchedAtMs: Date.now() };
    } catch (e) {
      if (isAbort(e)) throw e;
      lastError = e;
    }
  }

  const stale = await cacheGet<FuelPrice>(key, FOREVER);
  if (stale) return { price: stale.value, fromCache: true, fetchedAtMs: Date.now() - stale.ageMs };
  throw lastError;
}
