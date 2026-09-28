import { formatAgo, formatDecimal, formatDuration, formatEuroCents, formatKm, formatShortDate, parseDecimalInput, splitEuroCents } from '../format';
import { addRecent } from '../../state/store';
import type { Place } from '../types';

describe('Dutch formatting', () => {
  it('formats euro cents', () => {
    expect(formatEuroCents(1525)).toBe('€ 15,25');
    expect(formatEuroCents(5)).toBe('€ 0,05');
    expect(formatEuroCents(150000)).toBe('€ 1.500,00');
    expect(splitEuroCents(254200)).toEqual({ euros: '2.542', cents: '00' });
  });

  it('formats decimals, km, dates and durations', () => {
    expect(formatDecimal(6.2)).toBe('6,2');
    expect(formatDecimal(2.449, 3)).toBe('2,449');
    expect(formatKm(213)).toBe('213 km');
    expect(formatKm(12.34)).toBe('12,3 km');
    expect(formatShortDate('2026-09-21')).toBe('21 sep');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(172)).toBe('2 u 52 min');
  });

  it('parses Dutch and English decimal input', () => {
    expect(parseDecimalInput('6,5')).toBe(6.5);
    expect(parseDecimalInput(' 6.5 ')).toBe(6.5);
    expect(parseDecimalInput('abc')).toBeNaN();
    expect(parseDecimalInput('')).toBeNaN();
    expect(parseDecimalInput('-1')).toBeNaN();
  });

  it('formats relative time', () => {
    const now = 1_000_000_000;
    expect(formatAgo(now - 30_000, now)).toBe('zojuist');
    expect(formatAgo(now - 12 * 60_000, now)).toBe('12 min geleden');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 uur geleden');
  });
});

describe('recent destinations', () => {
  const p = (id: string, extra: Partial<Place> = {}): Place => ({ id, label: id, lat: 52.123456789, lon: 5.987654321, kind: 'city', source: 'pdok', ...extra });

  it('keeps most recent first, de-duplicates and caps at 8', () => {
    let list = addRecent([], p('a'), { carCents: 100 }, 1);
    list = addRecent(list, p('b'), { carCents: 200 }, 2);
    list = addRecent(list, p('a'), { carCents: 150 }, 3);
    expect(list.map((r) => r.place.id)).toEqual(['a', 'b']);
    expect(list[0].lastCostCents).toBe(150);
    for (let i = 0; i < 20; i++) list = addRecent(list, p(`x${i}`));
    expect(list).toHaveLength(8);
  });

  it('rounds stored coordinates and never stores the current location', () => {
    const list = addRecent([], p('a'));
    expect(list[0].place.lat).toBe(52.12346);
    expect(addRecent([], p('me', { kind: 'current-location' }))).toEqual([]);
  });
});
