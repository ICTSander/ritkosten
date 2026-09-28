/**
 * Fuel & electricity prices from CBS StatLine (open data, keyless, CORS enabled).
 *
 * - 80416ned: daily national average pump prices (Euro95, diesel, LPG), incl. taxes.
 *   Weighted average of real card transactions (not advisory prices). Published weekly,
 *   so the newest day is typically 3–10 days old — we always show that date.
 * - 85592NED: monthly average consumer electricity tariff (delivery + energy tax, incl. VAT),
 *   used for "thuis laden". Excludes fixed costs.
 * - 84991NED: quarterly average public charging price per kWh ("openbaar laden").
 *
 * Other countries plug in via the FuelPriceProvider registry (see registry at the bottom).
 */
import type { CountryCode, FuelPrice, PricedFuel } from '../domain/types';
import { AppError, fetchJson, type FetchJsonOptions } from './http';

const CBS = 'https://datasets.cbs.nl/odata/v1/CBS';

interface CbsObservation {
  Measure: string;
  Value: number | null;
  Perioden: string;
  Btw?: string;
}
interface CbsResponse {
  value: CbsObservation[];
}

export const CBS_PUMP_MEASURES: Record<'petrol' | 'diesel' | 'lpg', string> = {
  petrol: 'A047220', // Benzine Euro95
  diesel: 'A019275',
  lpg: 'A027841',
};

export type ChargingMode = 'home' | 'public';

/** "20260921" → "2026-09-21"; "2026MM08" → "2026-08-01"; "2026KW02" → "2026-04-01". */
export function parseCbsPeriod(period: string): string {
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(period);
  if (day) return `${day[1]}-${day[2]}-${day[3]}`;
  const month = /^(\d{4})MM(\d{2})$/.exec(period);
  if (month) return `${month[1]}-${month[2]}-01`;
  const quarter = /^(\d{4})KW(\d{2})$/.exec(period);
  if (quarter) {
    const m = (Number(quarter[2]) - 1) * 3 + 1;
    return `${quarter[1]}-${String(m).padStart(2, '0')}-01`;
  }
  throw new AppError('provider', `cbs: unknown period format ${period}`, 'cbs');
}

/** Human label for the period a price covers, e.g. "21 sep", "augustus 2026", "2e kwartaal 2026". */
export function periodLabel(period: string): string {
  const quarter = /^(\d{4})KW(\d{2})$/.exec(period);
  if (quarter) return `${Number(quarter[2])}e kwartaal ${quarter[1]}`;
  const iso = parseCbsPeriod(period);
  const date = new Date(`${iso}T12:00:00Z`);
  if (/MM/.test(period)) {
    return date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function isValidPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 10;
}

type HttpOpts = Pick<FetchJsonOptions, 'fetchFn' | 'signal' | 'sleep'>;

export async function fetchCbsPumpPrice(
  fuel: 'petrol' | 'diesel' | 'lpg',
  http: HttpOpts = {},
  now: Date = new Date(),
): Promise<FuelPrice> {
  const measure = CBS_PUMP_MEASURES[fuel];
  const url =
    `${CBS}/80416ned/Observations?$filter=${encodeURIComponent(`Measure eq '${measure}'`)}` +
    `&$orderby=${encodeURIComponent('Perioden desc')}&$top=5&$select=Measure,Value,Perioden`;
  const data = await fetchJson<CbsResponse>(url, { provider: 'cbs', ...http });
  const row = data.value?.find((r) => r.Measure === measure && isValidPrice(r.Value));
  if (!row) throw new AppError('not-found', 'cbs: no pump price available', 'cbs');

  return {
    fuel,
    pricePerUnit: row.Value as number,
    unit: 'L',
    currency: 'EUR',
    country: 'NL',
    observedAt: parseCbsPeriod(row.Perioden),
    fetchedAt: now.toISOString(),
    source: 'cbs',
    method: 'national-average',
    methodLabel: `Landelijk gemiddelde pompprijs (CBS), ${periodLabel(row.Perioden)}`,
  };
}

const ELECTRICITY_DELIVERY = 'M007924_2';
const ELECTRICITY_TAX = 'A045057_2';
const VAT_INCLUDED = 'A048944';
const PUBLIC_CHARGING = 'A041293';

export async function fetchCbsElectricityPrice(
  mode: ChargingMode,
  http: HttpOpts = {},
  now: Date = new Date(),
): Promise<FuelPrice> {
  let value: number;
  let period: string;
  let label: string;

  if (mode === 'public') {
    const url =
      `${CBS}/84991NED/Observations?$filter=${encodeURIComponent(`Measure eq '${PUBLIC_CHARGING}'`)}` +
      `&$orderby=${encodeURIComponent('Perioden desc')}&$top=2`;
    const data = await fetchJson<CbsResponse>(url, { provider: 'cbs', ...http });
    const row = data.value?.find((r) => isValidPrice(r.Value));
    if (!row) throw new AppError('not-found', 'cbs: no charging price', 'cbs');
    value = row.Value as number;
    period = row.Perioden;
    label = `Gemiddelde prijs openbaar laden (CBS), ${periodLabel(period)}`;
  } else {
    const filter = `Btw eq '${VAT_INCLUDED}' and (Measure eq '${ELECTRICITY_DELIVERY}' or Measure eq '${ELECTRICITY_TAX}')`;
    const url =
      `${CBS}/85592NED/Observations?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=${encodeURIComponent('Perioden desc')}&$top=6`;
    const data = await fetchJson<CbsResponse>(url, { provider: 'cbs', ...http });
    const rows = data.value ?? [];
    // Find the newest month that has BOTH components.
    const periods = [...new Set(rows.map((r) => r.Perioden))].sort().reverse();
    const complete = periods.find((p) => {
      const ms = rows.filter((r) => r.Perioden === p && isValidPrice(r.Value)).map((r) => r.Measure);
      return ms.includes(ELECTRICITY_DELIVERY) && ms.includes(ELECTRICITY_TAX);
    });
    if (!complete) throw new AppError('not-found', 'cbs: no electricity tariff', 'cbs');
    const pick = (m: string) => rows.find((r) => r.Perioden === complete && r.Measure === m)!.Value as number;
    value = Math.round((pick(ELECTRICITY_DELIVERY) + pick(ELECTRICITY_TAX)) * 10_000) / 10_000;
    period = complete;
    label = `Gemiddeld stroomtarief thuis incl. energiebelasting (CBS), ${periodLabel(period)}`;
  }

  return {
    fuel: 'electricity',
    pricePerUnit: value,
    unit: 'kWh',
    currency: 'EUR',
    country: 'NL',
    observedAt: parseCbsPeriod(period),
    fetchedAt: now.toISOString(),
    source: 'cbs',
    method: 'national-average',
    methodLabel: label,
  };
}

/** Age of the price data in whole days (by observation date, not fetch time). */
export function priceAgeDays(price: Pick<FuelPrice, 'observedAt'>, now: Date = new Date()): number {
  const observed = new Date(`${price.observedAt}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((today - observed) / 86_400_000));
}

/**
 * CBS publishes pump prices weekly with a lag, so ~10 days is normal.
 * Beyond these thresholds we warn the user (quarterly/monthly electricity data ages slower).
 */
export function isPriceStale(price: FuelPrice, now: Date = new Date()): boolean {
  const limit = price.fuel === 'electricity' ? 270 : 14;
  return price.source === 'cbs' && priceAgeDays(price, now) > limit;
}

// ---- Country registry -------------------------------------------------------

export interface FuelPriceProvider {
  id: string;
  getPrice(fuel: PricedFuel, opts: { chargingMode: ChargingMode } & HttpOpts): Promise<FuelPrice>;
}

const cbsProvider: FuelPriceProvider = {
  id: 'cbs',
  getPrice: (fuel, { chargingMode, ...http }) =>
    fuel === 'electricity' ? fetchCbsElectricityPrice(chargingMode, http) : fetchCbsPumpPrice(fuel, http),
};

/**
 * Add a country by registering providers here, e.g. DE → Tankerkönig (station prices,
 * needs a key → must go through a server proxy), FR → prix-carburants, AT → E-Control.
 */
export const FUEL_PRICE_PROVIDERS: Partial<Record<CountryCode, FuelPriceProvider[]>> = {
  NL: [cbsProvider],
};

/** Prices are currently national averages for NL; trips starting abroad still use NL until more countries are added. */
export function providersFor(country: CountryCode | undefined): FuelPriceProvider[] {
  return (country && FUEL_PRICE_PROVIDERS[country]) || FUEL_PRICE_PROVIDERS.NL!;
}
