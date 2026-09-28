/**
 * Dutch number formatting, implemented by hand so output is identical on Hermes, JSC,
 * web and Node (Intl data differs between engines).
 */

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1525 → "€ 15,25"; 150000 → "€ 1.500,00". */
export function formatEuroCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}€ ${groupThousands(String(euros))},${rest}`;
}

/** Split for the big price display: { euros: "15", cents: "25" }. */
export function splitEuroCents(cents: number): { euros: string; cents: string } {
  const abs = Math.abs(Math.round(cents));
  return { euros: groupThousands(String(Math.floor(abs / 100))), cents: String(abs % 100).padStart(2, '0') };
}

/** 6.2 → "6,2"; formatDecimal(2.449, 3) → "2,449"; strips nothing — fixed decimals. */
export function formatDecimal(value: number, decimals = 1): string {
  const [int, frac] = Math.abs(value).toFixed(decimals).split('.');
  return `${value < 0 ? '-' : ''}${groupThousands(int)}${frac ? `,${frac}` : ''}`;
}

/** Price per unit with 3 decimals like at the pump: "€ 2,449". */
export function formatUnitPrice(price: number, decimals = 3): string {
  return `€ ${formatDecimal(price, decimals)}`;
}

export function formatKm(km: number): string {
  return km >= 100 ? `${formatDecimal(Math.round(km), 0)} km` : `${formatDecimal(km, 1)} km`;
}

/** Parses Dutch or English decimal input: "6,5" / "6.5" → 6.5; invalid → NaN. */
export function parseDecimalInput(input: string): number {
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/** "zojuist", "12 min geleden", "3 uur geleden", "2 dagen geleden". */
export function formatAgo(fromMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 60) return 'zojuist';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 dag geleden' : `${d} dagen geleden`;
}

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "2026-09-21" → "21 sep". */
export function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} u ${rest} min` : `${h} u`;
}
