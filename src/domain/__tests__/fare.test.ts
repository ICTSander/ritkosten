import { calculatePublicTransportCost } from '../fare/engine';
import { isNsOffPeak, productFor, type TransitProfile } from '../fare/products';
import { FARE_DATA_2026, nsRow } from '../fare/tariffs';
import { nlLocalToIso, toNlLocal } from '../nlTime';
import type { Leg, LegMode } from '../transit';

/** Leg departing at a Dutch local time. */
function leg(mode: LegMode, km: number, local: [number, number, number, number, number], extra: Partial<Leg> = {}): Leg {
  const dep = nlLocalToIso(...local);
  const arr = new Date(Date.parse(dep) + 20 * 60_000).toISOString();
  return {
    mode,
    from: { name: 'A', lat: 0, lon: 0 },
    to: { name: 'B', lat: 0, lon: 0 },
    plannedDeparture: dep,
    plannedArrival: arr,
    departure: dep,
    arrival: arr,
    realtime: false,
    cancelled: false,
    distanceMeters: km * 1000,
    durationMin: 20,
    intermediateStops: 0,
    operator: mode === 'train' ? 'NS' : undefined,
    ...extra,
  };
}

const MON_1140: [number, number, number, number, number] = [2026, 9, 28, 11, 40]; // Monday
const SAT_1000: [number, number, number, number, number] = [2026, 10, 3, 10, 0]; // Saturday
const quote = (legs: Leg[], profile: TransitProfile) => calculatePublicTransportCost({ legs }, profile, FARE_DATA_2026);

describe('NS 2026 table', () => {
  it('matches the official price list', () => {
    expect(nsRow(FARE_DATA_2026.ns, 5)).toEqual([5, 300, 240, 180]); // 0 t/m 8 TE
    expect(nsRow(FARE_DATA_2026.ns, 20)).toEqual([20, 580, 464, 348]);
    expect(nsRow(FARE_DATA_2026.ns, 200)[1]).toBe(3330);
    expect(nsRow(FARE_DATA_2026.ns, 350)[1]).toBe(3330); // NS caps at 200 TE
    expect(FARE_DATA_2026.ns.rows).toHaveLength(201);
  });
});

describe('products', () => {
  const at = (y: number, m: number, d: number, h: number, min = 0) => toNlLocal(nlLocalToIso(y, m, d, h, min));

  it('NS off-peak windows', () => {
    expect(isNsOffPeak(at(2026, 9, 28, 8, 59))).toBe(false);
    expect(isNsOffPeak(at(2026, 9, 28, 9, 0))).toBe(true);
    expect(isNsOffPeak(at(2026, 9, 28, 16, 0))).toBe(false);
    expect(isNsOffPeak(at(2026, 9, 28, 18, 30))).toBe(true);
    expect(isNsOffPeak(at(2026, 9, 29, 6, 29))).toBe(true);
    expect(isNsOffPeak(at(2026, 9, 29, 6, 30))).toBe(false);
    expect(isNsOffPeak(at(2026, 10, 3, 8, 0))).toBe(true); // Saturday
    expect(isNsOffPeak(at(2026, 4, 27, 8, 0))).toBe(true); // Koningsdag: all day
    expect(isNsOffPeak(at(2026, 5, 5, 8, 0))).toBe(false); // 5 May 2026 is not an NS holiday
  });

  it('student week product: free Mon 04:00 – Sat 04:00, otherwise 40% train / 34% BTM', () => {
    const p = productFor({ product: 'student-week' });
    expect(p.effect('ns-train', at(2026, 9, 28, 3, 59))).toEqual({ type: 'percent', pct: 40 });
    expect(p.effect('ns-train', at(2026, 9, 28, 4, 0))).toEqual({ type: 'free' });
    expect(p.effect('btm', at(2026, 10, 3, 3, 59))).toEqual({ type: 'free' });
    expect(p.effect('btm', at(2026, 10, 3, 4, 0))).toEqual({ type: 'percent', pct: 34 });
    expect(p.effect('other-train', at(2026, 7, 20, 12, 0))).toEqual({ type: 'percent', pct: 40 }); // summer
  });

  it('student weekend product follows the DUO table', () => {
    const p = productFor({ product: 'student-weekend' });
    expect(p.effect('ns-train', at(2026, 10, 2, 8, 0))).toEqual({ type: 'none' }); // Fri 04–09 full
    expect(p.effect('ns-train', at(2026, 10, 2, 11, 59))).toEqual({ type: 'percent', pct: 40 }); // Fri 09–12
    expect(p.effect('ns-train', at(2026, 10, 2, 12, 0))).toEqual({ type: 'free' });
    expect(p.effect('btm', at(2026, 10, 5, 3, 59))).toEqual({ type: 'free' }); // Mon before 04:00
    expect(p.effect('ns-train', at(2026, 10, 5, 7, 0))).toEqual({ type: 'percent', pct: 40 }); // Mon: discount all day
    expect(p.effect('ns-train', at(2026, 10, 6, 7, 0))).toEqual({ type: 'none' }); // Tue 04–09 full
    expect(p.effect('btm', at(2026, 10, 6, 9, 0))).toEqual({ type: 'percent', pct: 34 });
  });

  it('student products on public holidays (DUO 2026)', () => {
    const week = productFor({ product: 'student-week' });
    const weekend = productFor({ product: 'student-weekend' });
    // Koningsdag, Monday 27 April 2026
    expect(week.effect('ns-train', at(2026, 4, 27, 10))).toEqual({ type: 'percent', pct: 40 });
    expect(week.effect('ns-train', at(2026, 4, 28, 3, 59))).toEqual({ type: 'percent', pct: 40 }); // until 04:00 next day
    expect(week.effect('ns-train', at(2026, 4, 28, 4, 0))).toEqual({ type: 'free' });
    expect(weekend.effect('ns-train', at(2026, 4, 27, 10))).toEqual({ type: 'free' });
    // Good Friday: free with both products
    expect(week.effect('btm', at(2026, 4, 3, 10))).toEqual({ type: 'free' });
    // Ascension Day: weekend product free from 12:00 the day before
    expect(weekend.effect('ns-train', at(2026, 5, 13, 11, 59))).toEqual({ type: 'percent', pct: 40 });
    expect(weekend.effect('ns-train', at(2026, 5, 13, 12, 0))).toEqual({ type: 'free' });
    expect(week.effect('ns-train', at(2026, 5, 14, 12, 0))).toEqual({ type: 'percent', pct: 40 });
  });

  it('NS products only apply to NS trains', () => {
    const p = productFor({ product: 'dal-voordeel' });
    expect(p.effect('other-train', at(2026, 9, 28, 11))).toEqual({ type: 'none' });
    expect(p.effect('btm', at(2026, 9, 28, 11))).toEqual({ type: 'none' });
    expect(productFor({ product: 'altijd-vrij' }).effect('ns-train', at(2026, 9, 28, 8))).toEqual({ type: 'free' });
  });

  it('custom percent is clamped and applies to trains only', () => {
    expect(productFor({ product: 'custom', customPercent: 150 }).effect('ns-train', at(2026, 9, 28, 8))).toEqual({ type: 'free' });
    expect(productFor({ product: 'custom', customPercent: 25 }).effect('btm', at(2026, 9, 28, 8))).toEqual({ type: 'none' });
  });
});

describe('calculatePublicTransportCost', () => {
  it('long NS trip without discount: capped at 200 TE (€ 33,30), estimate', () => {
    const q = quote([leg('walk', 0.6, MON_1140), leg('train', 215.6, MON_1140), leg('walk', 0.5, MON_1140)], { product: 'none' });
    expect(q).toMatchObject({ fullFareCents: 3330, discountCents: 0, finalCents: 3330, isEstimate: true });
    expect(q.lines).toHaveLength(1);
  });

  it('student week on a Monday: free and exact', () => {
    const q = quote([leg('train', 215.6, MON_1140)], { product: 'student-week' });
    expect(q).toMatchObject({ fullFareCents: 3330, discountCents: 3330, finalCents: 0, isEstimate: false });
    expect(q.lines[0].discountLabel).toBe('gratis');
  });

  it('uses NS’s own rounded 40% column', () => {
    const q = quote([leg('train', 20, SAT_1000)], { product: 'student-week' });
    expect(q.finalCents).toBe(348);
  });

  it('Dal Voordeel: peak = full fare, off-peak = 40%', () => {
    expect(quote([leg('train', 20, [2026, 9, 28, 8, 0])], { product: 'dal-voordeel' }).finalCents).toBe(580);
    expect(quote([leg('train', 20, [2026, 9, 28, 10, 0])], { product: 'dal-voordeel' }).finalCents).toBe(348);
  });

  it('prices a non-NS train separately and does not apply NS discounts to it', () => {
    const q = quote(
      [leg('train', 18.6, MON_1140, { operator: 'Arriva' }), leg('walk', 0.2, MON_1140), leg('train', 197.2, MON_1140)],
      { product: 'dal-voordeel' },
    );
    expect(q.lines.map((l) => [l.fullCents, l.finalCents])).toEqual([
      [550, 550], // 19 TE, Arriva: no NS discount
      [3300, 1980], // 197 TE, 40% column
    ]);
    expect(q.notes.join(' ')).toMatch(/Arriva heeft een eigen tarief/);
  });

  it('joins consecutive NS train legs into one fare', () => {
    const q = quote([leg('train', 10, MON_1140), leg('walk', 0.3, MON_1140), leg('train', 12, MON_1140)], { product: 'none' });
    expect(q.lines).toHaveLength(1);
    expect(q.fullFareCents).toBe(nsRow(FARE_DATA_2026.ns, 22)[1]);
  });

  it('bus: base fare + km rate; no new base fare within 35 minutes', () => {
    const first = leg('bus', 5, [2026, 9, 28, 10, 0], { operator: 'GVB' }); // 116 + 5 × 21.7 = 224.5 → 225
    const second = leg('bus', 3, [2026, 9, 28, 10, 30]); // transfer: 0 + 3 × 20.6 = 61.8 → 62
    const q = quote([first, second], { product: 'none' });
    expect(q.lines.map((l) => l.fullCents)).toEqual([225, 62]);
    expect(q.finalCents).toBe(287);
    expect(q.isEstimate).toBe(true);
  });

  it('charges a new base fare when a train ride sits between two buses', () => {
    const q = quote(
      [leg('bus', 3, [2026, 9, 28, 10, 0]), leg('train', 20, [2026, 9, 28, 10, 22]), leg('bus', 3, [2026, 9, 28, 10, 45])],
      { product: 'none' },
    );
    expect(q.lines[2].fullCents).toBe(Math.round(116 + 3 * 20.6));
  });

  it('charges a new base fare after 35 minutes', () => {
    const first = leg('bus', 3, [2026, 9, 28, 10, 0]); // arrives 10:20
    const later = leg('bus', 3, [2026, 9, 28, 11, 0]);
    expect(quote([first, later], { product: 'none' }).lines[1].fullCents).toBe(Math.round(116 + 3 * 20.6));
  });

  it('student discount on BTM is 34%', () => {
    const q = quote([leg('bus', 5, SAT_1000, { operator: 'GVB' })], { product: 'student-week' });
    expect(q.finalCents).toBe(Math.round((225 * 66) / 100)); // 148.5 → 149
  });

  it('custom 25% on a train', () => {
    expect(quote([leg('train', 20, MON_1140)], { product: 'custom', customPercent: 25 }).finalCents).toBe(435);
  });

  it('uses the official NS API fare when the whole journey is one NS fare', () => {
    const legs = [leg('train', 215.6, [2026, 9, 28, 10, 0])];
    const q = calculatePublicTransportCost({ legs, apiFullFareCents: 2980 }, { product: 'dal-voordeel' }, FARE_DATA_2026);
    expect(q).toMatchObject({ fullFareCents: 2980, finalCents: 1788, isEstimate: false });
  });

  it('walking-only journeys cost nothing', () => {
    expect(quote([leg('walk', 1, MON_1140)], { product: 'none' })).toMatchObject({ finalCents: 0, lines: [] });
  });
});
