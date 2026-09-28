/**
 * Car trip cost as a list of components. Today only fuel/charging is calculated;
 * parking, toll, wear or per-km costs can be added later as extra components
 * without changing the comparison or the UI contract.
 */
import { calculateTripCost, type TripCostResult } from './calculation';

export type CostComponentKind = 'fuel' | 'parking' | 'toll' | 'wear' | 'other';

export interface CostComponent {
  kind: CostComponentKind;
  label: string;
  /** One-way amount in cents. */
  cents: number;
  isEstimate: boolean;
}

export interface CarCost {
  components: CostComponent[];
  /** One-way total in cents. */
  totalCents: number;
  /** Return total: 2× one-way (so the screen always adds up). */
  returnCents: number;
  fuel: TripCostResult;
}

export function calculateCarCost(input: {
  distanceKm: number;
  consumptionPer100Km: number;
  pricePerUnit: number;
  electric: boolean;
  /** Future components (parking, toll…). Not used yet. */
  extras?: CostComponent[];
}): CarCost {
  const fuel = calculateTripCost(input);
  const components: CostComponent[] = [
    { kind: 'fuel', label: input.electric ? 'Laadkosten' : 'Brandstof', cents: fuel.estimatedCostCents, isEstimate: true },
    ...(input.extras ?? []),
  ];
  const totalCents = components.reduce((sum, c) => sum + c.cents, 0);
  return { components, totalCents, returnCents: totalCents * 2, fuel };
}
