/**
 * Travel products (subscriptions / discounts) as DATA, so rules can be updated without touching
 * the engine. Every rule cites an official source. Status: researched 2026-09-28.
 *
 * Not modelled (yet): 1st class, surcharges (ICE / IC direct), night buses and cross-border
 * trains, and public holidays for years other than those listed below. The explanation says so.
 */
import { hm, type NlLocalTime } from '../nlTime';

export type ProductId =
  | 'none'
  | 'student-week'
  | 'student-weekend'
  | 'ns-flex'
  | 'dal-voordeel'
  | 'dal-vrij'
  | 'altijd-vrij'
  | 'custom';

export type Effect = { type: 'free' } | { type: 'percent'; pct: number } | { type: 'none' };

/** What kind of leg a rule applies to. NS products only cover trains operated by NS. */
export type LegScope = 'ns-train' | 'other-train' | 'btm';

export interface ProductDefinition {
  id: ProductId;
  label: string;
  description: string;
  sourceUrl?: string;
  /** Returns the effect for a leg that starts at `t` (check-in time decides). */
  effect: (scope: LegScope, t: NlLocalTime) => Effect;
}

const NONE: Effect = { type: 'none' };

/**
 * Public holidays as published by the product owners (they differ!). Dates are local (NL).
 * DUO: https://duo.nl/particulier/ov-en-reizen/wanneer-reizen.jsp (checked 2026-09-28, page updated 2026-08-19)
 * NS:  https://www.ns.nl/uitgelicht/wanneer-reizen-met-voordeel/wanneer-reist-u-met-korting.html
 *      (5 May 2026 is NOT an off-peak day; Liberation Day is a day off only every 5 years)
 */
export const HOLIDAYS: Record<number, { duo: string[]; ns: string[]; duoFreeFromNoonBefore: string[]; goodFriday: string }> = {
  2026: {
    duo: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-04-27', '2026-05-05', '2026-05-14', '2026-05-25', '2026-12-25'],
    ns: ['2026-01-01', '2026-04-03', '2026-04-27', '2026-05-14', '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26'],
    /** Weekend product: free from 12:00 the day before Good Friday and Ascension Day. */
    duoFreeFromNoonBefore: ['2026-04-03', '2026-05-14'],
    goodFriday: '2026-04-03',
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
/** Calendar date of the local time. */
const dayOf = (t: NlLocalTime) => dateKey(t.year, t.month, t.day);
/** DUO "04:00 – 04:00 the next day" travel day. */
const duoDayOf = (t: NlLocalTime) => (t.minutes < hm(4) ? dateKey(t.year, t.month, t.day - 1) : dayOf(t));
const tomorrowOf = (t: NlLocalTime) => dateKey(t.year, t.month, t.day + 1);

export const holidaysKnownFor = (year: number) => !!HOLIDAYS[year];

/**
 * NS off-peak ("dal"): weekdays 09:00–16:00 and 18:30–06:30, all weekend.
 * https://www.ns.nl/uitgelicht/wanneer-reizen-met-voordeel/wanneer-reist-u-met-korting.html
 */
export function isNsOffPeak(t: NlLocalTime): boolean {
  if (t.weekday === 0 || t.weekday === 6) return true;
  if (HOLIDAYS[t.year]?.ns.includes(dayOf(t))) return true; // holidays: off-peak all day
  const m = t.minutes;
  return (m >= hm(9) && m < hm(16)) || m >= hm(18, 30) || m < hm(6, 30);
}

/** Minutes since Monday 00:00 local time (0 … 10079). */
const weekMinute = (t: NlLocalTime) => ((t.weekday + 6) % 7) * 1440 + t.minutes;

/** Summer period in which the week product is discount-only: 16 Jul 04:00 – 16 Aug 04:00. */
function inStudentSummer(t: NlLocalTime): boolean {
  const md = t.month * 100 + t.day;
  if (md > 716 && md < 816) return true;
  if (md === 716) return t.minutes >= hm(4);
  if (md === 816) return t.minutes < hm(4);
  return false;
}

/** Student discount outside free periods: 40% on train, 34% on bus/tram/metro. */
const studentDiscount = (scope: LegScope): Effect => ({ type: 'percent', pct: scope === 'btm' ? 34 : 40 });

export const PRODUCTS: Record<Exclude<ProductId, 'custom'>, ProductDefinition> = {
  none: {
    id: 'none',
    label: 'Geen korting',
    description: 'Volle prijs',
    effect: () => NONE,
  },
  'student-week': {
    id: 'student-week',
    label: 'Studentenreisproduct week',
    description: 'Gratis ma 04:00 – za 04:00, daarbuiten korting',
    sourceUrl: 'https://www.studentenreisproduct.nl/en/ik-ben-een-reizende-student/geldigheid-studentenreisproduct/',
    effect: (scope, t) => {
      const h = HOLIDAYS[t.year];
      const day = duoDayOf(t);
      // Holidays: discount 04:00 – 04:00, except Good Friday (free).
      if (h?.duo.includes(day)) return day === h.goodFriday ? { type: 'free' } : studentDiscount(scope);
      const w = weekMinute(t);
      const free = w >= hm(4) && w < 5 * 1440 + hm(4); // Mon 04:00 – Sat 04:00
      return free && !inStudentSummer(t) ? { type: 'free' } : studentDiscount(scope);
    },
  },
  'student-weekend': {
    id: 'student-weekend',
    label: 'Studentenreisproduct weekend',
    description: 'Gratis vr 12:00 – ma 04:00 en op feestdagen, anders meestal korting',
    sourceUrl: 'https://duo.nl/particulier/ov-en-reizen/wanneer-reizen.jsp',
    effect: (scope, t) => {
      const h = HOLIDAYS[t.year];
      // Holidays: free 04:00 – 04:00; Good Friday and Ascension: already from 12:00 the day before.
      if (h?.duo.includes(duoDayOf(t))) return { type: 'free' };
      if (h?.duoFreeFromNoonBefore.includes(tomorrowOf(t)) && t.minutes >= hm(12)) return { type: 'free' };
      const w = weekMinute(t);
      const free = w >= 4 * 1440 + hm(12) || w < hm(4); // Fri 12:00 – Mon 04:00
      if (free) return { type: 'free' };
      // Monday after 04:00: discount all day. Tue–Fri: full fare 04:00 – 09:00, otherwise discount.
      if (t.weekday === 1) return studentDiscount(scope);
      return t.minutes >= hm(4) && t.minutes < hm(9) ? NONE : studentDiscount(scope);
    },
  },
  'ns-flex': {
    id: 'ns-flex',
    label: 'NS Flex (basis)',
    description: 'Achteraf betalen, geen korting',
    sourceUrl: 'https://www.ns.nl/abonnementen/',
    effect: () => NONE,
  },
  'dal-voordeel': {
    id: 'dal-voordeel',
    label: 'Dal Voordeel',
    description: '40% korting op NS-treinen buiten de spits',
    sourceUrl: 'https://www.ns.nl/uitgelicht/wanneer-reizen-met-voordeel/wanneer-reist-u-met-korting.html',
    effect: (scope, t) => (scope === 'ns-train' && isNsOffPeak(t) ? { type: 'percent', pct: 40 } : NONE),
  },
  'dal-vrij': {
    id: 'dal-vrij',
    label: 'Dal Vrij',
    description: 'Gratis met NS-treinen buiten de spits',
    sourceUrl: 'https://www.ns.nl/en/travel/nederland-dal-vrij',
    effect: (scope, t) => (scope === 'ns-train' && isNsOffPeak(t) ? { type: 'free' } : NONE),
  },
  'altijd-vrij': {
    id: 'altijd-vrij',
    label: 'Altijd Vrij',
    description: 'Altijd gratis met NS-treinen',
    sourceUrl: 'https://www.ns.nl/abonnementen/',
    effect: (scope) => (scope === 'ns-train' ? { type: 'free' } : NONE),
  },
};

export interface TransitProfile {
  product: ProductId;
  /** Only for 'custom': percentage discount applied to train legs. */
  customPercent?: number;
}

export const DEFAULT_TRANSIT_PROFILE: TransitProfile = { product: 'none' };

export function productFor(profile: TransitProfile): ProductDefinition {
  if (profile.product === 'custom') {
    const pct = Math.min(100, Math.max(0, Math.round(profile.customPercent ?? 0)));
    return {
      id: 'custom',
      label: `${pct}% korting`,
      description: 'Eigen korting op treinreizen',
      effect: (scope) => (scope !== 'btm' && pct > 0 ? (pct === 100 ? { type: 'free' } : { type: 'percent', pct }) : NONE),
    };
  }
  return PRODUCTS[profile.product] ?? PRODUCTS.none;
}

export const PRODUCT_OPTIONS: { id: ProductId; label: string; description: string }[] = [
  { id: 'none', label: 'Geen korting', description: 'Volle prijs' },
  { id: 'student-week', label: 'Studentenreisproduct', description: 'Gratis of met korting reizen' },
  { id: 'ns-flex', label: 'NS Flex (basis)', description: 'Achteraf betalen, zonder korting' },
  { id: 'dal-voordeel', label: 'Dal Voordeel', description: '40% korting buiten de spits' },
  { id: 'dal-vrij', label: 'Dal Vrij', description: 'Gratis buiten de spits' },
  { id: 'altijd-vrij', label: 'Altijd Vrij', description: 'Altijd gratis met de trein' },
  { id: 'custom', label: 'Andere korting', description: 'Vul zelf een percentage in' },
];
