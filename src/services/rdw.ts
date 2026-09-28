/**
 * Vehicle data from RDW Open Data (Dutch vehicle authority; public domain, keyless, CORS).
 *
 * Datasets:
 *  - m9d7-ebf2 "Gekentekende voertuigen": kenteken, merk, handelsbenaming, datum_eerste_toelating, cilinderinhoud
 *  - 8ys7-d773 "Brandstof": one row per fuel per kenteken, with WLTP/NEDC consumption and CO₂
 *
 * RDW has no "1.5 TSI" trim names and SoQL cannot join datasets. For make+model+year we
 * therefore sample registered cars, fetch their fuel rows, and group them into engine
 * variants (fuel · displacement · power) with the MEDIAN official consumption.
 */
import makesData from '../data/makes.json';
import modelsData from '../data/models.json';
import type { Consumption, EnergyType, PricedFuel, Vehicle } from '../domain/types';
import { cacheGet, cached, cacheSet, DAY } from './cache';
import { AppError, fetchJson, type FetchJsonOptions } from './http';

type HttpOpts = Pick<FetchJsonOptions, 'fetchFn' | 'signal' | 'sleep'>;

const BASE = 'https://opendata.rdw.nl/resource';
const VEHICLES = `${BASE}/m9d7-ebf2.json`;
const FUEL = `${BASE}/8ys7-d773.json`;

/**
 * Litres per 100 km ≈ WLTP CO₂ (g/km) ÷ factor. Factors follow the WLTP carbon-balance
 * formula for the reference fuels (E10 petrol ≈ 22.8, B7 diesel ≈ 25.9, LPG ≈ 16.3) and
 * match RDW records that have both figures.
 */
export const CO2_PER_LITER_FACTOR = { petrol: 22.8, diesel: 25.9, lpg: 16.3 } as const;

const PLAUSIBLE = { L: [1.5, 30], kWh: [8, 45] } as const;

function rdwHeaders(): Record<string, string> | undefined {
  const token = process.env.EXPO_PUBLIC_RDW_APP_TOKEN;
  return token ? { 'X-App-Token': token } : undefined;
}

function rdw<T>(url: string, http: HttpOpts, timeoutMs = 15_000): Promise<T> {
  return fetchJson<T>(url, { provider: 'rdw', timeoutMs, retries: 2, headers: rdwHeaders(), ...http });
}

/** SoQL string literal with quotes escaped. */
export function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// ---- Formatting --------------------------------------------------------------

const MAKE_DISPLAY: Record<string, string> = {
  BMW: 'BMW',
  'BMW I': 'BMW i',
  MG: 'MG',
  DS: 'DS',
  BYD: 'BYD',
  VW: 'Volkswagen',
  'MERCEDES-BENZ': 'Mercedes-Benz',
  'MERCEDES-AMG': 'Mercedes-AMG',
  'LYNK&CO': 'Lynk & Co',
  'TESLA MOTORS': 'Tesla',
  CITROEN: 'Citroën',
};

export function displayMake(rdwMake: string): string {
  if (MAKE_DISPLAY[rdwMake]) return MAKE_DISPLAY[rdwMake];
  return rdwMake
    .toLowerCase()
    .replace(/(^|[\s-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** "320I" → "320i", "GOLF" → "Golf", "MODEL 3" → "Model 3", "ID.3" → "ID.3", "C-HR" → "C-HR". */
export function displayModel(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/\d/.test(word)) {
        // Keep short codes like X3, ID.3, Q4 upper; lower-case a trailing letter suffix (320I → 320i).
        return word.replace(/(\d)([A-Z]+)$/, (_, d: string, s: string) => d + s.toLowerCase());
      }
      if (word.length <= 3 || /^[A-Z]-[A-Z]+$/.test(word)) return word.toUpperCase();
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** "HPV60X" → "HPV-60-X"; groups on letter/digit transitions (Dutch side codes). */
export function formatPlate(plate: string): string {
  const p = normalizePlate(plate);
  const groups = p.match(/[A-Z]+|\d+/g) ?? [p];
  if (groups.length === 2) {
    const longer = groups[0].length >= groups[1].length ? 0 : 1;
    const g = groups[longer];
    groups.splice(longer, 1, g.slice(0, g.length / 2), g.slice(g.length / 2));
  }
  return groups.join('-');
}

export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(input: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizePlate(input));
}

// ---- Makes & models ----------------------------------------------------------

export interface MakeOption {
  rdw: string;
  display: string;
  count: number;
}

export const MAKES: MakeOption[] = makesData.makes
  .filter((m) => !['VW', 'TESLA MOTORS'].includes(m.rdw)) // aliases of bigger entries
  .map((m) => ({ ...m, display: displayMake(m.rdw) }));

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

export function searchMakes(query: string, limit = 6): MakeOption[] {
  const q = fold(query);
  if (!q) return MAKES.slice(0, limit);
  const starts = MAKES.filter((m) => fold(m.display).startsWith(q) || fold(m.rdw).startsWith(q));
  const contains = MAKES.filter((m) => !starts.includes(m) && fold(m.display).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Split "volkswagen go" into a known make + the remaining model query. Longest make wins. */
export function splitMakeQuery(query: string): { make: MakeOption; rest: string } | null {
  const q = query.trim().toLowerCase();
  const candidates = MAKES.filter((m) => {
    const d = m.display.toLowerCase();
    return q === d || q.startsWith(`${d} `);
  }).sort((a, b) => b.display.length - a.display.length);
  const make = candidates[0];
  return make ? { make, rest: q.slice(make.display.length).trim() } : null;
}

export interface ModelOption {
  /** Grouping key: upper-case name without make prefix or punctuation, e.g. "GOLF", "TROC", "UP". */
  key: string;
  display: string;
  /** Raw RDW handelsbenaming values that map to this model (upper-cased). */
  rawNames: string[];
  count: number;
}

export function normalizeModelName(make: string, raw: string): string {
  let name = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const prefixes = [make.toUpperCase(), displayMake(make).toUpperCase(), make === 'VOLKSWAGEN' ? 'VW' : ''];
  for (const prefix of prefixes) {
    if (prefix && name.startsWith(`${prefix} `)) name = name.slice(prefix.length + 1);
  }
  return name;
}

export function groupModels(make: string, rows: { model?: string; n: string }[]): ModelOption[] {
  const byKey = new Map<string, ModelOption>();
  for (const row of rows) {
    if (!row.model) continue;
    const name = normalizeModelName(make, row.model);
    const key = name.replace(/[^A-Z0-9]/g, '');
    if (!key) continue;
    const existing = byKey.get(key);
    const count = Number(row.n) || 0;
    if (existing) {
      existing.count += count;
      if (!existing.rawNames.includes(row.model)) existing.rawNames.push(row.model);
    } else {
      byKey.set(key, { key, display: displayModel(name), rawNames: [row.model], count });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

const BUNDLED_MODELS = (modelsData as unknown as { models: Record<string, [string, number][]> }).models;

/**
 * Models for a make. Uses (1) a fresh cache, else (2) the list bundled at build time — instant —
 * while refreshing from RDW in the background, else (3) a live RDW query.
 */
export async function fetchModels(make: string, http: HttpOpts = {}): Promise<ModelOption[]> {
  const key = `rdw:models:${make}`;
  const hit = await cacheGet<ModelOption[]>(key, 30 * DAY);
  if (hit) return hit.value;
  const bundled = BUNDLED_MODELS[make];
  if (bundled?.length) {
    fetchModelsLive(make, {})
      .then((fresh) => (fresh.length ? cacheSet(key, fresh) : undefined))
      .catch(() => {});
    return groupModels(make, bundled.map(([model, n]) => ({ model, n: String(n) })));
  }
  return cached(key, 30 * DAY, () => fetchModelsLive(make, http));
}

async function fetchModelsLive(make: string, http: HttpOpts): Promise<ModelOption[]> {
  const params = new URLSearchParams({
      $select: 'upper(handelsbenaming) as model, count(*) as n',
      $where: `voertuigsoort='Personenauto' AND merk=${soqlString(make)} AND datum_eerste_toelating > '20050101'`,
      $group: 'model',
      $having: 'n >= 30',
      $order: 'n DESC',
      $limit: '400',
    });
  const rows = await rdw<{ model?: string; n: string }[]>(`${VEHICLES}?${params}`, http);
  return groupModels(make, rows);
}

export function filterModels(models: ModelOption[], query: string, limit = 8): ModelOption[] {
  const q = fold(query);
  if (!q) return models.slice(0, limit);
  const starts = models.filter((m) => fold(m.key).startsWith(q));
  const contains = models.filter((m) => !starts.includes(m) && fold(m.key).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

function modelWhere(make: string, model: ModelOption): string {
  const names = model.rawNames.map(soqlString).join(',');
  return `voertuigsoort='Personenauto' AND merk=${soqlString(make)} AND upper(handelsbenaming) in (${names})`;
}

export async function fetchYears(make: string, model: ModelOption, http: HttpOpts = {}): Promise<number[]> {
  return cached(`rdw:years:${make}:${model.key}`, 30 * DAY, async () => {
    const params = new URLSearchParams({
      $select: 'date_extract_y(datum_eerste_toelating_dt) as y, count(*) as n',
      $where: modelWhere(make, model),
      $group: 'y',
      $order: 'y DESC',
      $limit: '80',
    });
    const rows = await rdw<{ y?: string; n: string }[]>(`${VEHICLES}?${params}`, http);
    const thisYear = new Date().getFullYear();
    return rows
      .filter((r) => r.y && Number(r.n) >= 10)
      .map((r) => Number(r.y))
      .filter((y) => y >= 1990 && y <= thisYear);
  });
}

// ---- Fuel rows → energy type & consumption --------------------------------------

export interface FuelRow {
  kenteken: string;
  brandstof_omschrijving?: string;
  klasse_hybride_elektrisch_voertuig?: string;
  nettomaximumvermogen?: string;
  netto_max_vermogen_elektrisch?: string;
  brandstof_verbruik_gecombineerd_wltp?: string;
  emissie_co2_gecombineerd_wltp?: string;
  brandstofverbruik_gecombineerd?: string;
  co2_uitstoot_gecombineerd?: string;
  elektrisch_verbruik_enkel_elektrisch_wltp?: string;
  elektrisch_verbruik_extern_opladen_wltp?: string;
}

const FUEL_FIELDS: (keyof FuelRow)[] = [
  'kenteken',
  'brandstof_omschrijving',
  'klasse_hybride_elektrisch_voertuig',
  'nettomaximumvermogen',
  'netto_max_vermogen_elektrisch',
  'brandstof_verbruik_gecombineerd_wltp',
  'emissie_co2_gecombineerd_wltp',
  'brandstofverbruik_gecombineerd',
  'co2_uitstoot_gecombineerd',
  'elektrisch_verbruik_enkel_elektrisch_wltp',
  'elektrisch_verbruik_extern_opladen_wltp',
];

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const plausible = (value: number | undefined, unit: 'L' | 'kWh') =>
  value !== undefined && value >= PLAUSIBLE[unit][0] && value <= PLAUSIBLE[unit][1] ? value : undefined;

export interface CarEnergy {
  energy: EnergyType;
  pricedFuel: PricedFuel;
  powerKw?: number;
  consumption?: { value: number; unit: 'L' | 'kWh'; method: Consumption['method'] };
}

const kindOf = (row: FuelRow) => (row.brandstof_omschrijving ?? '').toLowerCase();

/** Classify one car from its fuel rows. Returns null for fuels we can't price (hydrogen, CNG…). */
export function classifyCar(rows: FuelRow[]): CarEnergy | null {
  const byKind = (k: string) => rows.find((r) => kindOf(r) === k);
  const petrol = byKind('benzine');
  const diesel = byKind('diesel');
  const lpg = byKind('lpg');
  const electric = byKind('elektriciteit');
  const hybridClass = rows.find((r) => r.klasse_hybride_elektrisch_voertuig)?.klasse_hybride_elektrisch_voertuig;

  const combustion = petrol ?? diesel ?? lpg;
  const round1 = (v: number) => Math.round(v * 10) / 10;

  const liquidConsumption = (row: FuelRow, fuel: 'petrol' | 'diesel' | 'lpg', allowNedc: boolean) => {
    const wltp = plausible(num(row.brandstof_verbruik_gecombineerd_wltp), 'L');
    if (wltp) return { value: wltp, unit: 'L' as const, method: 'wltp' as const };
    const co2 = num(row.emissie_co2_gecombineerd_wltp);
    const fromCo2 = co2 ? plausible(round1(co2 / CO2_PER_LITER_FACTOR[fuel]), 'L') : undefined;
    if (fromCo2) return { value: fromCo2, unit: 'L' as const, method: 'co2' as const };
    if (!allowNedc) return undefined;
    const nedc = plausible(num(row.brandstofverbruik_gecombineerd), 'L');
    if (nedc) return { value: nedc, unit: 'L' as const, method: 'nedc' as const };
    const nedcCo2 = num(row.co2_uitstoot_gecombineerd);
    const fromNedcCo2 = nedcCo2 ? plausible(round1(nedcCo2 / CO2_PER_LITER_FACTOR[fuel]), 'L') : undefined;
    return fromNedcCo2 ? { value: fromNedcCo2, unit: 'L' as const, method: 'nedc' as const } : undefined;
  };

  if (!combustion && electric) {
    const whPerKm = num(electric.elektrisch_verbruik_enkel_elektrisch_wltp);
    const kwh = whPerKm ? plausible(round1(whPerKm / 10), 'kWh') : undefined;
    return {
      energy: 'ev',
      pricedFuel: 'electricity',
      powerKw: num(electric.netto_max_vermogen_elektrisch) ?? num(electric.nettomaximumvermogen),
      consumption: kwh ? { value: kwh, unit: 'kWh', method: 'wltp' } : undefined,
    };
  }
  if (!combustion) return null;

  const fuel: 'petrol' | 'diesel' | 'lpg' = petrol ? 'petrol' : diesel ? 'diesel' : 'lpg';
  const powerKw = num(combustion.nettomaximumvermogen);

  if (hybridClass === 'OVC-HEV') {
    // Plug-in hybrid: the weighted WLTP figure (≈1–2 L) assumes a full battery and is useless for a
    // trip estimate. Only use the charge-sustaining (empty battery) figure when RDW has it.
    return {
      energy: 'phev',
      pricedFuel: fuel,
      powerKw,
      consumption: liquidConsumption(combustion, fuel, false),
    };
  }

  // Bi-fuel LPG cars have a petrol AND an LPG row: price on LPG (that's why people fit it).
  if (lpg && petrol) {
    return { energy: 'lpg', pricedFuel: 'lpg', powerKw: num(lpg.nettomaximumvermogen) ?? powerKw, consumption: liquidConsumption(lpg, 'lpg', true) };
  }

  return {
    energy: hybridClass === 'NOVC-HEV' ? 'hybrid' : fuel,
    pricedFuel: fuel,
    powerKw,
    consumption: liquidConsumption(combustion, fuel, true),
  };
}

export function median(values: number[]): number | undefined {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ---- Variants ------------------------------------------------------------------

export interface VariantOption {
  id: string;
  label: string;
  sublabel: string;
  energy: EnergyType;
  pricedFuel: PricedFuel;
  engineCc?: number;
  powerKw?: number;
  consumption: Consumption | null;
  count: number;
}

export const ENERGY_LABEL: Record<EnergyType, string> = {
  petrol: 'Benzine',
  diesel: 'Diesel',
  lpg: 'LPG',
  hybrid: 'Hybride',
  phev: 'Plug-in hybride',
  ev: 'Elektrisch',
};

const kwToHp = (kw: number) => Math.round(kw * 1.35962);

export function variantLabel(energy: EnergyType, engineCc?: number, powerKw?: number): { label: string; sublabel: string } {
  const liters = engineCc ? (Math.round(engineCc / 100) / 10).toFixed(1) : undefined;
  const power = powerKw ? `${Math.round(powerKw)} kW · ${kwToHp(powerKw)} pk` : undefined;
  const label = [energy === 'ev' ? undefined : liters, ENERGY_LABEL[energy]].filter(Boolean).join(' ');
  return { label, sublabel: power ?? '' };
}

export interface CarSample {
  cc?: number;
  energy: CarEnergy;
}

/** Group sampled cars into engine variants with a median consumption. */
export function aggregateVariants(cars: CarSample[], minCount = 3): VariantOption[] {
  const all = buildVariants(cars, 1);
  const common = all.filter((v) => v.count >= minCount);
  // Few cars for this model/year: rather show every engine than nothing.
  return common.length ? common : all;
}

function buildVariants(cars: CarSample[], minCount: number): VariantOption[] {
  const groups = new Map<string, CarSample[]>();
  for (const car of cars) {
    const e = car.energy;
    const ccBucket = e.energy === 'ev' ? 0 : Math.round((car.cc ?? 0) / 100);
    const kw = e.powerKw ? Math.round(e.powerKw) : 0;
    const key = `${e.energy}|${e.pricedFuel}|${ccBucket}|${kw}`;
    groups.set(key, [...(groups.get(key) ?? []), car]);
  }

  const out: VariantOption[] = [];
  for (const [key, list] of groups) {
    if (list.length < minCount) continue;
    const first = list[0].energy;
    const withValue = list.filter((c) => c.energy.consumption);
    const value = median(withValue.map((c) => c.energy.consumption!.value));
    const methods = withValue.map((c) => c.energy.consumption!.method);
    const method = (['wltp', 'co2', 'nedc'] as const)
      .map((m) => [m, methods.filter((x) => x === m).length] as const)
      .sort((a, b) => b[1] - a[1])[0][0];
    const engineCc = median(list.map((c) => c.cc).filter((x): x is number => !!x));
    const { label, sublabel } = variantLabel(first.energy, engineCc, first.powerKw);
    out.push({
      id: key,
      label,
      sublabel,
      energy: first.energy,
      pricedFuel: first.pricedFuel,
      engineCc: engineCc ? Math.round(engineCc) : undefined,
      powerKw: first.powerKw,
      count: list.length,
      consumption:
        value !== undefined
          ? {
              value: Math.round(value * 10) / 10,
              unit: first.pricedFuel === 'electricity' ? 'kWh' : 'L',
              source: 'rdw',
              method,
              sampleSize: withValue.length,
            }
          : null,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

async function fetchFuelRows(kentekens: string[], http: HttpOpts): Promise<FuelRow[]> {
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < kentekens.length; i += CHUNK) chunks.push(kentekens.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      const params = new URLSearchParams({
        $select: FUEL_FIELDS.join(','),
        $where: `kenteken in (${chunk.map(soqlString).join(',')})`,
        $limit: String(chunk.length * 4),
      });
      return rdw<FuelRow[]>(`${FUEL}?${params}`, http);
    }),
  );
  return results.flat();
}

function groupByPlate(rows: FuelRow[]): Map<string, FuelRow[]> {
  const map = new Map<string, FuelRow[]>();
  for (const r of rows) map.set(r.kenteken, [...(map.get(r.kenteken) ?? []), r]);
  return map;
}

export async function fetchVariants(
  make: string,
  model: ModelOption,
  year: number,
  http: HttpOpts = {},
): Promise<VariantOption[]> {
  const key = `rdw:variants:v3:${make}:${model.key}:${year}`;
  const hit = await cacheGet<VariantOption[]>(key, 30 * DAY);
  if (hit) return hit.value;
  const variants = await (async () => {
    const params = new URLSearchParams({
      $select: 'kenteken,cilinderinhoud',
      $where: `${modelWhere(make, model)} AND datum_eerste_toelating between '${year}0101' and '${year}1231'`,
      $limit: '800',
    });
    const cars = await rdw<{ kenteken: string; cilinderinhoud?: string }[]>(`${VEHICLES}?${params}`, http);
    if (!cars.length) throw new AppError('not-found', 'rdw: no cars for this model/year', 'rdw');

    const fuelByPlate = groupByPlate(await fetchFuelRows(cars.map((c) => c.kenteken), http));
    const samples: CarSample[] = [];
    for (const car of cars) {
      const energy = classifyCar(fuelByPlate.get(car.kenteken) ?? []);
      if (energy) samples.push({ cc: num(car.cilinderinhoud), energy });
    }
    return aggregateVariants(samples);
  })();
  if (variants.length) await cacheSet(key, variants); // never cache an empty answer
  return variants;
}

// ---- Licence plate -----------------------------------------------------------------

/** The plate exists, but we can't estimate it (not a passenger car, or hydrogen/CNG/…). Retrying won't help. */
export class UnsupportedVehicleError extends Error {
  constructor(public readonly reason: 'not-a-car' | 'fuel') {
    super(`rdw: unsupported vehicle (${reason})`);
    this.name = 'UnsupportedVehicleError';
  }
}

interface VehicleRow {
  kenteken: string;
  voertuigsoort?: string;
  merk?: string;
  handelsbenaming?: string;
  datum_eerste_toelating?: string;
  cilinderinhoud?: string;
}

export async function lookupPlate(input: string, http: HttpOpts = {}): Promise<Vehicle> {
  const plate = normalizePlate(input);
  if (!isValidPlate(plate)) throw new AppError('not-found', 'rdw: invalid plate', 'rdw');

  const [vehicles, fuelRows] = await Promise.all([
    rdw<VehicleRow[]>(`${VEHICLES}?kenteken=${plate}`, http, 8000),
    rdw<FuelRow[]>(`${FUEL}?kenteken=${plate}`, http, 8000),
  ]);
  const v = vehicles[0];
  if (!v?.merk) throw new AppError('not-found', 'rdw: plate not found', 'rdw');
  if (v.voertuigsoort && v.voertuigsoort !== 'Personenauto') throw new UnsupportedVehicleError('not-a-car');

  const energy = classifyCar(fuelRows);
  if (!energy) throw new UnsupportedVehicleError('fuel');

  const engineCc = num(v.cilinderinhoud);
  const { label, sublabel } = variantLabel(energy.energy, engineCc, energy.powerKw);
  const year = v.datum_eerste_toelating ? Number(v.datum_eerste_toelating.slice(0, 4)) : undefined;

  return {
    make: displayMake(v.merk),
    model: displayModel(normalizeModelName(v.merk, v.handelsbenaming ?? '')),
    year,
    variantLabel: [label, sublabel].filter(Boolean).join(' · '),
    engineCc,
    powerKw: energy.powerKw,
    energy: energy.energy,
    pricedFuel: energy.pricedFuel,
    consumption: energy.consumption ? { ...energy.consumption, source: 'rdw' } : null,
    plate,
  };
}

export function vehicleFromVariant(make: MakeOption, model: ModelOption, year: number, variant: VariantOption): Vehicle {
  return {
    make: make.display,
    model: model.display,
    year,
    variantLabel: [variant.label, variant.sublabel].filter(Boolean).join(' · '),
    engineCc: variant.engineCc,
    powerKw: variant.powerKw,
    energy: variant.energy,
    pricedFuel: variant.pricedFuel,
    consumption: variant.consumption,
  };
}
