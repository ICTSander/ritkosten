import { nlLocalToIso, toNlLocal } from '../nlTime';
import { defaultArrival, parseClock } from '../../ui/TimePicker';

describe('typing a time', () => {
  it('understands the usual ways to write a time', () => {
    expect(parseClock('9')).toBe(9 * 60);
    expect(parseClock('930')).toBe(9 * 60 + 30);
    expect(parseClock('0930')).toBe(9 * 60 + 30);
    expect(parseClock('9:30')).toBe(9 * 60 + 30);
    expect(parseClock('9.30')).toBe(9 * 60 + 30);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
  });
  it('rejects nonsense', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('25')).toBeNull();
    expect(parseClock('9:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});

describe('default arrival time', () => {
  const at = (h: number, m: number) => Date.parse(nlLocalToIso(2026, 9, 28, h, m));
  it('is about an hour from now during the day', () => {
    expect(toNlLocal(defaultArrival(at(14, 7))).minutes).toBe(15 * 60 + 15);
  });
  it('is tomorrow 09:00 late in the evening', () => {
    const local = toNlLocal(defaultArrival(at(23, 30)));
    expect([local.day, local.minutes]).toEqual([29, 9 * 60]);
  });
  it('is today 09:00 in the middle of the night', () => {
    const local = toNlLocal(defaultArrival(at(2, 0)));
    expect([local.day, local.minutes]).toEqual([28, 9 * 60]);
  });
});
