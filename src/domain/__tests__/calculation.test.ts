import {
  calculateTripCost,
  CalculationInputError,
  roundHalfUp,
} from '../calculation';

describe('roundHalfUp', () => {
  it.each([
    [1.005, 2, 1.01], // classic float trap: 1.005 is stored as 1.00499999…
    [2.675, 2, 2.68],
    [1.255, 2, 1.26],
    [0.125, 2, 0.13],
    [15.2519, 2, 15.25],
    [0.12649, 3, 0.126],
    [0.1265, 3, 0.127],
    [-1.005, 2, -1.01],
    [0, 2, 0],
    [7.44, 2, 7.44],
  ])('roundHalfUp(%p, %p) = %p', (value, decimals, expected) => {
    expect(roundHalfUp(value, decimals)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfUp(-0.001, 2), 0)).toBe(true);
  });

  it('rejects non-finite numbers', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(RangeError);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('calculateTripCost', () => {
  it('matches the reference example (120 km, 6.2 L/100 km, €2.05/L)', () => {
    const r = calculateTripCost({ distanceKm: 120, consumptionPer100Km: 6.2, pricePerUnit: 2.05 });
    expect(r.unitsUsed).toBe(7.44);
    expect(r.estimatedCost).toBe(15.25); // 15.252 → 15.25
    expect(r.estimatedCostCents).toBe(1525);
    expect(r.returnCost).toBe(30.5); // 30.504 → 30.50
    expect(r.returnCostCents).toBe(3050);
    expect(r.costPerKm).toBe(0.127);
  });

  it('makes the return trip exactly 2× the shown one-way cost', () => {
    // one way: 10 km × 5 L/100 km × €2.005 = €1.0025 → €1.00; return shown as €2.00, never €2.01
    const r = calculateTripCost({ distanceKm: 10, consumptionPer100Km: 5, pricePerUnit: 2.005 });
    expect(r.estimatedCostCents).toBe(100);
    expect(r.returnCostCents).toBe(200);
  });

  it('rounds half-up on a half-cent boundary despite float noise', () => {
    // 100 × 5 × 2.001 / 100 = 10.005 (stored as 10.00499…) → €10.01, naive Math.round gives €10.00
    const r = calculateTripCost({ distanceKm: 100, consumptionPer100Km: 5, pricePerUnit: 2.001 });
    expect(r.estimatedCostCents).toBe(1001);
    expect(r.returnCostCents).toBe(2002);
  });

  it('rounds an EV cost that is 15.7499… in binary to €15.75', () => {
    const r = calculateTripCost({ distanceKm: 250, consumptionPer100Km: 18, pricePerUnit: 0.35 });
    expect(r.unitsUsed).toBe(45);
    expect(r.estimatedCostCents).toBe(1575);
    expect(r.returnCostCents).toBe(3150);
  });

  it('shows a tiny trip as at least one hundredth of a liter', () => {
    const r = calculateTripCost({ distanceKm: 0.1, consumptionPer100Km: 5, pricePerUnit: 2 });
    expect(r.unitsUsed).toBe(0.01);
    expect(r.estimatedCostCents).toBe(1);
  });

  it('handles the maximum distance', () => {
    const r = calculateTripCost({ distanceKm: 20_000, consumptionPer100Km: 6.2, pricePerUnit: 2.05 });
    expect(r.unitsUsed).toBe(1240);
    expect(r.estimatedCostCents).toBe(254200);
  });

  it('keeps cents and euro values consistent', () => {
    for (const distanceKm of [0.3, 17.7, 42.195, 123.456, 999.9]) {
      const r = calculateTripCost({ distanceKm, consumptionPer100Km: 5.7, pricePerUnit: 1.899 });
      expect(r.estimatedCost * 100).toBeCloseTo(r.estimatedCostCents, 8);
      expect(Number.isInteger(r.estimatedCostCents)).toBe(true);
      expect(Number.isInteger(r.returnCostCents)).toBe(true);
    }
  });

  it('works for electricity (kWh/100 km × €/kWh)', () => {
    // 250 km × 16 kWh/100 km × €0.35 = 40 kWh → €14.00
    const r = calculateTripCost({ distanceKm: 250, consumptionPer100Km: 16, pricePerUnit: 0.35 });
    expect(r.unitsUsed).toBe(40);
    expect(r.estimatedCost).toBe(14);
    expect(r.returnCost).toBe(28);
  });

  it('handles a zero-distance trip', () => {
    const r = calculateTripCost({ distanceKm: 0, consumptionPer100Km: 6, pricePerUnit: 2 });
    expect(r).toMatchObject({ unitsUsed: 0, estimatedCost: 0, returnCost: 0 });
  });

  it('handles long distances without precision loss', () => {
    // Maastricht → Lisbon-ish: 2,300 km × 6.5 × €1.999 = 149.5 L → €298.85
    const r = calculateTripCost({ distanceKm: 2300, consumptionPer100Km: 6.5, pricePerUnit: 1.999 });
    expect(r.unitsUsed).toBe(149.5);
    expect(r.estimatedCostCents).toBe(29885);
  });

  it.each([
    ['distanceKm', { distanceKm: -1, consumptionPer100Km: 6, pricePerUnit: 2 }],
    ['distanceKm', { distanceKm: Number.NaN, consumptionPer100Km: 6, pricePerUnit: 2 }],
    ['distanceKm', { distanceKm: 50_000, consumptionPer100Km: 6, pricePerUnit: 2 }],
    ['consumptionPer100Km', { distanceKm: 10, consumptionPer100Km: -6, pricePerUnit: 2 }],
    ['consumptionPer100Km', { distanceKm: 10, consumptionPer100Km: Number.POSITIVE_INFINITY, pricePerUnit: 2 }],
    ['pricePerUnit', { distanceKm: 10, consumptionPer100Km: 6, pricePerUnit: 205 }],
    ['pricePerUnit', { distanceKm: 10, consumptionPer100Km: 6, pricePerUnit: '2' as unknown as number }],
  ])('rejects invalid %s', (field, input) => {
    expect(() => calculateTripCost(input)).toThrow(CalculationInputError);
    try {
      calculateTripCost(input);
    } catch (e) {
      expect((e as CalculationInputError).field).toBe(field);
    }
  });
});
