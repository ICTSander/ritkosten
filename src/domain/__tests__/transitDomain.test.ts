import { calculateCarCost } from '../carCost';
import { compareModes } from '../comparison';
import { amsterdamOffsetMinutes, formatNlClock, nlLocalToIso, toNlLocal } from '../nlTime';
import { filterItineraries, sortItineraries, type TransitItinerary } from '../transit';
import { latestCarDeparture, orderForQuery } from '../../state/compare';

describe('Dutch local time', () => {
  it('handles summer and winter time and the switch-over', () => {
    expect(formatNlClock('2026-09-28T09:40:00Z')).toBe('11:40');
    expect(toNlLocal('2026-09-28T09:40:00Z')).toMatchObject({ weekday: 1, minutes: 700 });
    expect(formatNlClock('2026-01-05T12:00:00Z')).toBe('13:00');
    expect(amsterdamOffsetMinutes(Date.parse('2026-10-25T00:59:00Z'))).toBe(120);
    expect(amsterdamOffsetMinutes(Date.parse('2026-10-25T01:00:00Z'))).toBe(60);
    expect(amsterdamOffsetMinutes(Date.parse('2026-03-29T01:00:00Z'))).toBe(120);
  });

  it('converts local clock time back to UTC', () => {
    expect(nlLocalToIso(2026, 9, 28, 11, 40)).toBe('2026-09-28T09:40:00.000Z');
    expect(nlLocalToIso(2026, 12, 24, 18, 0)).toBe('2026-12-24T17:00:00.000Z');
  });
});

describe('car cost', () => {
  it('fuel is the first component; return = 2 × one way', () => {
    const c = calculateCarCost({ distanceKm: 120, consumptionPer100Km: 6.2, pricePerUnit: 2.05, electric: false });
    expect(c.components).toEqual([{ kind: 'fuel', label: 'Brandstof', cents: 1525, isEstimate: true }]);
    expect(c.totalCents).toBe(1525);
    expect(c.returnCents).toBe(3050);
  });

  it('is ready for future cost components', () => {
    const c = calculateCarCost({
      distanceKm: 120,
      consumptionPer100Km: 6.2,
      pricePerUnit: 2.05,
      electric: false,
      extras: [{ kind: 'parking', label: 'Parkeren', cents: 500, isEstimate: true }],
    });
    expect(c.totalCents).toBe(2025);
  });
});

describe('neutral comparison', () => {
  it('states facts both ways', () => {
    expect(compareModes({ cents: 1840, durationMin: 107 }, { cents: 1420, durationMin: 118 }).map((l) => l.text)).toEqual([
      'OV is € 4,20 goedkoper',
      'De auto is 11 min sneller',
    ]);
    expect(compareModes({ cents: 1000, durationMin: 90 }, { cents: 1500, durationMin: 60 }).map((l) => l.text)).toEqual([
      'De auto is € 5,00 goedkoper',
      'OV is 30 min sneller',
    ]);
  });

  it('doubles for a return trip and calls tiny differences equal', () => {
    expect(compareModes({ cents: 1790, durationMin: 102 }, { cents: 1420, durationMin: 115 }, 2)[0].text).toBe('OV is € 7,40 goedkoper');
    expect(compareModes({ cents: 1000, durationMin: 60 }, { cents: 1005, durationMin: 61 }).map((l) => l.text)).toEqual([
      'Auto en OV kosten ongeveer hetzelfde',
      'Ongeveer even snel',
    ]);
  });

  it('never compares unknown values', () => {
    expect(compareModes({ cents: null, durationMin: 60 }, { cents: 500, durationMin: null })).toEqual([]);
  });
});

describe('itinerary filters', () => {
  const mk = (id: string, dep: string, dur: number, transfers: number, modes: string[]): TransitItinerary =>
    ({
      id,
      providerId: 't',
      departure: dep,
      arrival: dep,
      durationMin: dur,
      transfers,
      realtime: false,
      legs: modes.map((mode) => ({ mode })),
    }) as unknown as TransitItinerary;
  const list = [mk('a', '2026-09-28T10:00:00Z', 90, 2, ['walk', 'bus', 'train']), mk('b', '2026-09-28T09:00:00Z', 120, 0, ['train']), mk('c', '2026-09-28T09:30:00Z', 80, 1, ['tram', 'metro'])];

  it('sorts by departure, speed or transfers', () => {
    expect(sortItineraries(list, 'departure').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortItineraries(list, 'fastest').map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(sortItineraries(list, 'fewest-transfers').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps only journeys whose vehicles are all allowed', () => {
    expect(filterItineraries(list, { modes: ['train', 'bus'] }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(filterItineraries(list, { modes: ['train'] }).map((x) => x.id)).toEqual(['b']);
  });
});

describe('arrival time', () => {
  const opt = (id: string, dep: string, arr: string) => ({ itinerary: { id, departure: dep, arrival: arr } as TransitItinerary });
  const options = [
    opt('early', '2026-09-28T12:00:00Z', '2026-09-28T13:00:00Z'),
    opt('best', '2026-09-28T12:30:00Z', '2026-09-28T13:25:00Z'),
    opt('late', '2026-09-28T13:00:00Z', '2026-09-28T14:00:00Z'),
  ];

  it('picks the latest departure that still arrives on time', () => {
    const r = orderForQuery(options, { kind: 'arrive', at: '2026-09-28T13:30:00Z' });
    expect(r.map((o) => o.itinerary.id)).toEqual(['best', 'early', 'late']);
  });

  it('falls back to the first late journey when none is on time', () => {
    const r = orderForQuery(options, { kind: 'arrive', at: '2026-09-28T12:50:00Z' });
    expect(r[0].itinerary.id).toBe('early');
  });

  it('otherwise orders by departure', () => {
    expect(orderForQuery([...options].reverse(), { kind: 'now' }).map((o) => o.itinerary.id)).toEqual(['early', 'best', 'late']);
  });

  it('drops journeys that already departed', () => {
    const r = orderForQuery(options, { kind: 'arrive', at: '2026-09-28T13:30:00Z' }, Date.parse('2026-09-28T12:10:00Z'));
    expect(r.map((o) => o.itinerary.id)).toEqual(['best', 'late']);
  });

  it('computes the latest car departure', () => {
    expect(latestCarDeparture('2026-09-28T13:30:00.000Z', 95)).toBe('2026-09-28T11:55:00.000Z');
  });
});
