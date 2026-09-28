import { formatDecimal } from '../domain/format';
import type { Consumption, Place, PricedFuel, Vehicle } from '../domain/types';
import { AppError, isAppError } from '../services/http';
import { ENERGY_LABEL } from '../services/rdw';
import type { IconName } from './Icon';

export const FUEL_LABEL: Record<PricedFuel, string> = {
  petrol: 'Benzine (Euro95)',
  diesel: 'Diesel',
  lpg: 'LPG',
  electricity: 'Stroom',
};

export const unitWord = (fuel: PricedFuel) => (fuel === 'electricity' ? 'kWh' : 'liter');
export const perUnit = (fuel: PricedFuel) => (fuel === 'electricity' ? 'per kWh' : 'per liter');

export function consumptionText(c: Pick<Consumption, 'value' | 'unit'>): string {
  return `${formatDecimal(c.value, 1)} ${c.unit === 'kWh' ? 'kWh' : 'L'}/100 km`;
}

export function consumptionSource(c: Consumption): string {
  const n = c.sampleSize && c.sampleSize > 1 ? `, mediaan van ${c.sampleSize} auto's` : '';
  switch (c.method) {
    case 'wltp':
      return `Officieel WLTP-verbruik (RDW${n})`;
    case 'co2':
      return `Berekend uit de officiële CO₂-uitstoot (RDW${n})`;
    case 'nedc':
      return `Officieel NEDC-verbruik (RDW${n}) — oudere, gunstigere meting`;
    default:
      return 'Door jou ingevuld';
  }
}

export function vehicleTitle(v: Vehicle): string {
  return `${v.make} ${v.model}`;
}

export function vehicleSubtitle(v: Vehicle): string {
  return [v.year, v.variantLabel ?? ENERGY_LABEL[v.energy]].filter(Boolean).join(' · ');
}

/** Short chip text, e.g. "Golf · Benzine". */
export function vehicleChip(v: Vehicle): string {
  return `${v.model} · ${ENERGY_LABEL[v.energy]}`;
}

/** Plain-language error text. Errors say what happened and what to do. */
export function errorMessage(e: unknown, what: string): string {
  if (isAppError(e)) {
    switch ((e as AppError).kind) {
      case 'offline':
        return `Geen internetverbinding. Controleer je verbinding en probeer het opnieuw.`;
      case 'timeout':
        return `${what} duurt te lang. Probeer het opnieuw.`;
      case 'rate-limit':
        return `Even te veel aanvragen. Probeer het over een halve minuut opnieuw.`;
      case 'not-found':
        return `${what}: niets gevonden.`;
      default:
        return `${what} lukt nu niet. Probeer het opnieuw.`;
    }
  }
  return `${what} lukt nu niet. Probeer het opnieuw.`;
}

export function placeIcon(p: Place): IconName {
  if (p.kind === 'city') return 'city';
  if (p.kind === 'station') return 'train';
  if (p.kind === 'poi') return 'museum';
  if (p.kind === 'current-location') return 'location';
  return 'pin';
}
