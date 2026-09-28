import AsyncStorage from '@react-native-async-storage/async-storage';

import { cacheClearAll } from '../cache';
import * as providers from '../fuelPrices';
import { fetchCbsElectricityPrice, fetchCbsPumpPrice, isPriceStale, parseCbsPeriod, periodLabel, priceAgeDays } from '../fuelPrices';
import { AppError } from '../http';
import { resolvePrice } from '../priceService';
import { fakeFetch } from './helpers';

const NOW = new Date('2026-09-28T10:00:00Z');

describe('CBS periods', () => {
  it('parses day, month and quarter codes', () => {
    expect(parseCbsPeriod('20260921')).toBe('2026-09-21');
    expect(parseCbsPeriod('2026MM08')).toBe('2026-08-01');
    expect(parseCbsPeriod('2026KW02')).toBe('2026-04-01');
    expect(() => parseCbsPeriod('2026JJ00')).toThrow();
  });

  it('labels quarters in Dutch', () => {
    expect(periodLabel('2026KW02')).toBe('2e kwartaal 2026');
  });
});

describe('fetchCbsPumpPrice', () => {
  it('takes the newest valid row for the requested measure', async () => {
    const { fetchFn, calls } = fakeFetch({
      value: [
        { Measure: 'A047220', Value: null, Perioden: '20260922' },
        { Measure: 'A047220', Value: 2.449, Perioden: '20260921' },
      ],
    });
    const p = await fetchCbsPumpPrice('petrol', { fetchFn }, NOW);
    expect(decodeURIComponent(calls[0])).toContain("Measure eq 'A047220'");
    expect(p).toMatchObject({ fuel: 'petrol', pricePerUnit: 2.449, unit: 'L', observedAt: '2026-09-21', source: 'cbs', method: 'national-average' });
    expect(p.methodLabel).toContain('CBS');
  });

  it('throws not-found when CBS returns nothing usable', async () => {
    const { fetchFn } = fakeFetch({ value: [{ Measure: 'A019275', Value: 99, Perioden: '20260921' }] });
    await expect(fetchCbsPumpPrice('diesel', { fetchFn })).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('fetchCbsElectricityPrice', () => {
  it('home: adds delivery tariff + energy tax of the newest complete month', async () => {
    const { fetchFn } = fakeFetch({
      value: [
        { Measure: 'M007924_2', Value: 0.15, Perioden: '2026MM09', Btw: 'A048944' }, // tax row for Sept missing
        { Measure: 'M007924_2', Value: 0.1469, Perioden: '2026MM08', Btw: 'A048944' },
        { Measure: 'A045057_2', Value: 0.11085, Perioden: '2026MM08', Btw: 'A048944' },
      ],
    });
    const p = await fetchCbsElectricityPrice('home', { fetchFn }, NOW);
    expect(p).toMatchObject({ fuel: 'electricity', unit: 'kWh', pricePerUnit: 0.2578, observedAt: '2026-08-01' });
  });

  it('public charging uses the quarterly average', async () => {
    const { fetchFn } = fakeFetch({ value: [{ Measure: 'A041293', Value: 0.409, Perioden: '2026KW02' }] });
    const p = await fetchCbsElectricityPrice('public', { fetchFn }, NOW);
    expect(p.pricePerUnit).toBe(0.409);
    expect(p.methodLabel).toContain('2e kwartaal 2026');
  });
});

describe('staleness', () => {
  const price = (observedAt: string, fuel: 'petrol' | 'electricity' = 'petrol') =>
    ({ fuel, observedAt, source: 'cbs' }) as Parameters<typeof isPriceStale>[0];

  it('uses the observation date, not the fetch time', () => {
    expect(priceAgeDays(price('2026-09-21'), NOW)).toBe(7);
    expect(isPriceStale(price('2026-09-21'), NOW)).toBe(false); // normal CBS lag
    expect(isPriceStale(price('2026-09-10'), NOW)).toBe(true);
    expect(isPriceStale(price('2026-04-01', 'electricity'), NOW)).toBe(false); // quarterly data ages slower
  });
});

describe('resolvePrice fallback chain', () => {
  beforeEach(async () => {
    await cacheClearAll();
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('uses a user override without any network call', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const r = await resolvePrice({ fuel: 'diesel', chargingMode: 'home', override: 1.999 });
    expect(r.price).toMatchObject({ pricePerUnit: 1.999, source: 'user', method: 'user-entered' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('serves the last known price (flagged) when CBS fails', async () => {
    const getPrice = jest.fn();
    jest.spyOn(providers, 'providersFor').mockReturnValue([{ id: 'x', getPrice }]);

    getPrice.mockResolvedValueOnce({ fuel: 'petrol', pricePerUnit: 2.449, observedAt: '2026-09-21', source: 'cbs' });
    const first = await resolvePrice({ fuel: 'petrol', chargingMode: 'home' });
    expect(first.fromCache).toBe(false);

    getPrice.mockRejectedValueOnce(new AppError('offline', 'down'));
    const second = await resolvePrice({ fuel: 'petrol', chargingMode: 'home', forceRefresh: true });
    expect(second).toMatchObject({ fromCache: true, price: { pricePerUnit: 2.449 } });
  });

  it('throws when there is no price at all (UI then asks the user)', async () => {
    jest.spyOn(providers, 'providersFor').mockReturnValue([{ id: 'x', getPrice: jest.fn().mockRejectedValue(new AppError('offline', 'down')) }]);
    await expect(resolvePrice({ fuel: 'lpg', chargingMode: 'home' })).rejects.toMatchObject({ kind: 'offline' });
  });
});
