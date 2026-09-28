/**
 * Neutral, factual comparison of two ways to travel. We state differences in money and time;
 * we never label one option "better" — the user decides.
 */
import { formatEuroCents } from './format';

export interface ModeSummary {
  /** One-way cost in cents; null = unknown (never guessed). */
  cents: number | null;
  durationMin: number | null;
}

export interface ComparisonLine {
  kind: 'cost' | 'time';
  text: string;
}

function durationText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} u ${m} min` : `${h} u`;
}

/**
 * Facts like "OV is € 4,20 goedkoper" and "De auto is 13 min sneller".
 * Differences under 10 cents / 3 minutes are reported as "about the same".
 */
export function compareModes(car: ModeSummary, transit: ModeSummary, multiplier = 1): ComparisonLine[] {
  const lines: ComparisonLine[] = [];
  if (car.cents !== null && transit.cents !== null) {
    const diff = (car.cents - transit.cents) * multiplier;
    if (Math.abs(diff) < 10) lines.push({ kind: 'cost', text: 'Auto en OV kosten ongeveer hetzelfde' });
    else if (diff > 0) lines.push({ kind: 'cost', text: `OV is ${formatEuroCents(diff)} goedkoper` });
    else lines.push({ kind: 'cost', text: `De auto is ${formatEuroCents(-diff)} goedkoper` });
  }
  if (car.durationMin !== null && transit.durationMin !== null) {
    const diff = (transit.durationMin - car.durationMin) * multiplier;
    if (Math.abs(diff) < 3) lines.push({ kind: 'time', text: 'Ongeveer even snel' });
    else if (diff > 0) lines.push({ kind: 'time', text: `De auto is ${durationText(diff)} sneller` });
    else lines.push({ kind: 'time', text: `OV is ${durationText(-diff)} sneller` });
  }
  return lines;
}
