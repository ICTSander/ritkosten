/**
 * Dutch local time without relying on Intl time-zone data (differs per JS engine).
 * EU rule: summer time (UTC+2) from the last Sunday of March 01:00 UTC until the
 * last Sunday of October 01:00 UTC; otherwise UTC+1.
 */

function lastSundayUtc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const back = lastDay.getUTCDay(); // 0 = Sunday
  return Date.UTC(year, month, lastDay.getUTCDate() - back, 1, 0, 0);
}

export function amsterdamOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastSundayUtc(year, 2); // March
  const end = lastSundayUtc(year, 9); // October
  return utcMs >= start && utcMs < end ? 120 : 60;
}

export interface NlLocalTime {
  year: number;
  month: number; // 1–12
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

export function toNlLocal(iso: string | number): NlLocalTime {
  const utc = typeof iso === 'number' ? iso : Date.parse(iso);
  const d = new Date(utc + amsterdamOffsetMinutes(utc) * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** "09:41" in Dutch local time. */
export function formatNlClock(iso: string): string {
  const t = toNlLocal(iso);
  return `${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}`;
}

/** Build a UTC ISO string for a Dutch local date + clock time. */
export function nlLocalToIso(year: number, month: number, day: number, hours: number, minutes: number): string {
  const guess = Date.UTC(year, month - 1, day, hours, minutes) - 60 * 60_000;
  const offset = amsterdamOffsetMinutes(guess);
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - offset * 60_000).toISOString();
}

export const hm = (h: number, m = 0) => h * 60 + m;
