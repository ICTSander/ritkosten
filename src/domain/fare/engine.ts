/**
 * Public transport price engine.
 *
 *   calculatePublicTransportCost(journey, profile, fareData) →
 *     { fullFareCents, discountCents, finalCents, isEstimate, lines, notes }
 *
 * Per-leg pricing:
 *  - NS train: official 2026 NS table by tariff units. Consecutive NS train legs form one
 *    journey (one fare over the summed distance). Tariff units ≈ rail kilometres → ESTIMATE
 *    (the exact unit count per station pair is not public).
 *  - Other train operators: priced with the NS table as an estimate (their own tariffs differ).
 *  - Bus / tram / metro / ferry: base fare + km × regional rate; no new base fare when checking
 *    in within 35 min of the previous check-out. Route km ≠ tariff km → ESTIMATE.
 * Then the user's travel product (student, Dal Voordeel, …) is applied per fare line, using the
 * check-in time of that line. Rules live in products.ts (data), tariffs in tariffs.ts.
 */
import type { Leg, TransitItinerary } from '../transit';
import { toNlLocal } from '../nlTime';
import { type Effect, holidaysKnownFor, type LegScope, productFor, type TransitProfile } from './products';
import { btmTariffFor, type FareData, nsRow } from './tariffs';

export interface FareLine {
  label: string;
  legIndexes: number[];
  fullCents: number;
  finalCents: number;
  /** "gratis", "40% korting", or undefined when no discount applies. */
  discountLabel?: string;
  isEstimate: boolean;
}

export interface FareQuote {
  fullFareCents: number;
  discountCents: number;
  finalCents: number;
  isEstimate: boolean;
  lines: FareLine[];
  /** Plain-language caveats for the explanation screen. */
  notes: string[];
  productLabel: string;
}

const isNs = (leg: Leg) => /(^|\b)ns(\b|$)|nederlandse spoorwegen/i.test(leg.operator ?? '');
const km = (leg: Leg) => (leg.distanceMeters ?? 0) / 1000;

function applyEffect(fullCents: number, effect: Effect, table?: [number, number, number, number]): { cents: number; label?: string } {
  if (effect.type === 'free') return { cents: 0, label: 'gratis' };
  if (effect.type === 'percent') {
    // Use NS's own rounded discount columns when they exist.
    if (table && effect.pct === 40) return { cents: table[3], label: '40% korting' };
    if (table && effect.pct === 20) return { cents: table[2], label: '20% korting' };
    return { cents: Math.round((fullCents * (100 - effect.pct)) / 100), label: `${effect.pct}% korting` };
  }
  return { cents: fullCents };
}

interface Group {
  scope: LegScope;
  legIndexes: number[];
}

/** Group legs into fare units: consecutive NS train legs together; every other vehicle leg alone. */
function groupLegs(legs: Leg[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  legs.forEach((leg, i) => {
    if (leg.mode === 'walk') return; // walking between two NS trains keeps the NS journey
    const scope: LegScope = leg.mode === 'train' ? (isNs(leg) ? 'ns-train' : 'other-train') : 'btm'; // bus, tram, metro, ferry (and unknown vehicles) use the regional tariff
    if (scope === 'ns-train' && current?.scope === 'ns-train') {
      current.legIndexes.push(i);
      return;
    }
    current = { scope, legIndexes: [i] };
    groups.push(current);
  });
  return groups;
}

export function calculatePublicTransportCost(
  journey: Pick<TransitItinerary, 'legs'> & Partial<Pick<TransitItinerary, 'apiFullFareCents'>>,
  profile: TransitProfile,
  fareData: FareData,
): FareQuote {
  const product = productFor(profile);
  const lines: FareLine[] = [];
  const notes = new Set<string>();
  let lastBtmArrival: number | null = null;
  const groups = groupLegs(journey.legs);
  // Official NS price from the API (via our proxy) is exact — only usable when the whole
  // journey is one NS train fare.
  const apiFare = groups.length === 1 && groups[0].scope === 'ns-train' ? journey.apiFullFareCents : undefined;

  for (const group of groups) {
    const legs = group.legIndexes.map((i) => journey.legs[i]);
    const first = legs[0];
    const last = legs[legs.length - 1];
    const route = `${first.from.name} → ${last.to.name}`;
    const effect = product.effect(group.scope, toNlLocal(first.departure));

    if (group.scope === 'btm') {
      const tariff = btmTariffFor(fareData, first.operator);
      const start = Date.parse(first.departure);
      const transfer = lastBtmArrival !== null && start - lastBtmArrival <= fareData.btmTransferWindowMin * 60_000;
      const full = Math.round((transfer ? 0 : tariff.baseCents) + km(first) * tariff.centsPerKm);
      const applied = applyEffect(full, effect);
      lastBtmArrival = Date.parse(first.arrival);
      if (applied.cents > 0) {
        if (!tariff.verified) notes.add('Voor deze regio is het bus-/tramtarief geschat met het landelijk geïndexeerde tarief.');
        notes.add('Bus-, tram- en metroprijzen zijn een schatting: we rekenen met de routeafstand, niet met de officiële tariefafstand.');
      }
      lines.push({
        label: `${modeWord(first)}${first.line ? ` ${first.line}` : ''} · ${route}`,
        legIndexes: group.legIndexes,
        fullCents: full,
        finalCents: applied.cents,
        discountLabel: applied.label,
        // Free travel is exact; any price we compute is an estimate.
        isEstimate: applied.cents > 0,
      });
      continue;
    }

    if (apiFare !== undefined && apiFare > 0) {
      lastBtmArrival = null;
      const applied = applyEffect(apiFare, effect);
      lines.push({
        label: `Trein NS · ${route}`,
        legIndexes: group.legIndexes,
        fullCents: apiFare,
        finalCents: applied.cents,
        discountLabel: applied.label,
        isEstimate: false,
      });
      notes.add('Treinprijs volgens NS.');
      continue;
    }
    // A train ride in between ends the bus/tram transfer window (conservative: the 35-minute
    // rule is only applied between consecutive bus/tram/metro legs).
    lastBtmArrival = null;
    const units = legs.reduce((sum, l) => sum + km(l), 0);
    const row = nsRow(fareData.ns, units);
    const applied = applyEffect(row[1], effect, row);
    if (group.scope === 'other-train' && applied.cents > 0) {
      notes.add(`${first.operator ?? 'Deze vervoerder'} heeft een eigen tarief; we schatten de prijs met de NS-tarieftabel.`);
    }
    if (applied.cents > 0) notes.add('Treinprijzen zijn geschat met de officiële NS-tarieftabel 2026 op basis van de afstand.');
    lines.push({
      label: `Trein${first.operator ? ` ${first.operator}` : ''} · ${route}`,
      legIndexes: group.legIndexes,
      fullCents: row[1],
      finalCents: applied.cents,
      discountLabel: applied.label,
      isEstimate: applied.cents > 0,
    });
  }

  if (profile.product !== 'none' && profile.product !== 'ns-flex') {
    const year = journey.legs[0] ? toNlLocal(journey.legs[0].departure).year : new Date().getFullYear();
    notes.add(
      holidaysKnownFor(year)
        ? 'Toeslagen (zoals Intercity direct) en 1e klas zijn niet meegerekend.'
        : `Feestdagen in ${year} en toeslagen (zoals Intercity direct) zijn niet meegerekend.`,
    );
  }

  const fullFareCents = lines.reduce((s, l) => s + l.fullCents, 0);
  const finalCents = lines.reduce((s, l) => s + l.finalCents, 0);
  return {
    fullFareCents,
    discountCents: fullFareCents - finalCents,
    finalCents,
    isEstimate: lines.some((l) => l.isEstimate),
    lines,
    notes: [...notes],
    productLabel: product.label,
  };
}

function modeWord(leg: Leg): string {
  switch (leg.mode) {
    case 'bus':
      return 'Bus';
    case 'tram':
      return 'Tram';
    case 'metro':
      return 'Metro';
    case 'ferry':
      return 'Veerboot';
    default:
      return 'OV';
  }
}
