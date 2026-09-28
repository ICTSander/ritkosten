/**
 * Pure trip-cost calculation. No I/O, no React — fully unit tested.
 *
 * liters = distanceKm × consumptionPer100Km / 100
 * cost   = liters × pricePerUnit
 *
 * Works for liquid fuels (L/100 km, €/L) and electricity (kWh/100 km, €/kWh):
 * the maths is identical, only the unit label differs.
 *
 * Rounding: intermediate values stay unrounded; only the returned display values
 * are rounded (half-up, after stripping binary float noise). Cost values are also
 * returned as integer cents so callers never have to re-round.
 */

export interface TripCostInput {
  distanceKm: number;
  consumptionPer100Km: number;
  pricePerUnit: number;
}

export interface TripCostResult {
  /** Energy used one way (liters or kWh), rounded to 2 decimals. */
  unitsUsed: number;
  /** Estimated one-way cost in euro, rounded to cents. */
  estimatedCost: number;
  estimatedCostCents: number;
  /** Return trip: exactly 2× the rounded one-way cost, so the screen always adds up. */
  returnCost: number;
  returnCostCents: number;
  /** Cost per kilometre in euro, rounded to 3 decimals (e.g. 0.127). */
  costPerKm: number;
}

export class CalculationInputError extends Error {
  constructor(public readonly field: keyof TripCostInput, message: string) {
    super(message);
    this.name = 'CalculationInputError';
  }
}

/** Sanity ceilings — anything above is almost certainly a data/unit error. */
export const LIMITS = {
  maxDistanceKm: 20_000,
  maxConsumptionPer100Km: 100, // covers heavy vans (L) and EVs (kWh)
  maxPricePerUnit: 10,
} as const;

/** Removes binary float noise, e.g. 1.0049999999999999 → 1.005. */
function clean(value: number): number {
  return Number.parseFloat(value.toPrecision(12));
}

/** Round half away from zero at `decimals`, robust against float noise. */
export function roundHalfUp(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) throw new RangeError('Cannot round a non-finite number');
  const factor = 10 ** decimals;
  const shifted = clean(clean(value) * factor);
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  return clean(rounded / factor) + 0; // `+ 0` normalises -0 to 0
}

function assertValid(input: TripCostInput): void {
  const checks: [keyof TripCostInput, number, number][] = [
    ['distanceKm', input.distanceKm, LIMITS.maxDistanceKm],
    ['consumptionPer100Km', input.consumptionPer100Km, LIMITS.maxConsumptionPer100Km],
    ['pricePerUnit', input.pricePerUnit, LIMITS.maxPricePerUnit],
  ];
  for (const [field, value, max] of checks) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CalculationInputError(field, `${field} must be a finite number`);
    }
    if (value < 0) throw new CalculationInputError(field, `${field} must not be negative`);
    if (value > max) throw new CalculationInputError(field, `${field} exceeds ${max}`);
  }
}

export function calculateTripCost(input: TripCostInput): TripCostResult {
  assertValid(input);
  const { distanceKm, consumptionPer100Km, pricePerUnit } = input;

  const units = (distanceKm * consumptionPer100Km) / 100;
  const cost = units * pricePerUnit;
  const estimatedCostCents = Math.round(roundHalfUp(cost, 2) * 100);
  const returnCostCents = estimatedCostCents * 2;

  return {
    unitsUsed: roundHalfUp(units, 2),
    estimatedCost: estimatedCostCents / 100,
    estimatedCostCents,
    returnCost: returnCostCents / 100,
    returnCostCents,
    costPerKm: roundHalfUp((consumptionPer100Km / 100) * pricePerUnit, 3),
  };
}
