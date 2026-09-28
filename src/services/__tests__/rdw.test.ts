import {
  aggregateVariants,
  classifyCar,
  displayMake,
  displayModel,
  filterModels,
  formatPlate,
  groupModels,
  isValidPlate,
  lookupPlate,
  median,
  normalizePlate,
  searchMakes,
  soqlString,
  splitMakeQuery,
  type FuelRow,
  UnsupportedVehicleError,
} from '../rdw';
import { fakeFetch } from './helpers';

const row = (r: Partial<FuelRow>): FuelRow => ({ kenteken: 'AA000A', ...r });

describe('plates', () => {
  it.each([
    ['hpv-60-x', 'HPV60X', 'HPV-60-X'],
    ['GZS88K', 'GZS88K', 'GZS-88-K'],
    ['zv 964 f', 'ZV964F', 'ZV-964-F'],
    ['99-XX-99', '99XX99', '99-XX-99'],
    ['XX9999', 'XX9999', 'XX-99-99'],
  ])('%s → %s → %s', (input, normalized, formatted) => {
    expect(normalizePlate(input)).toBe(normalized);
    expect(formatPlate(input)).toBe(formatted);
    expect(isValidPlate(input)).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isValidPlate('AB12')).toBe(false);
    expect(isValidPlate('AB-123-CD')).toBe(false);
  });
});

describe('SoQL escaping', () => {
  it('doubles single quotes', () => {
    expect(soqlString("O'NEIL")).toBe("'O''NEIL'");
    expect(soqlString("x') OR 1=1 --")).toBe("'x'') OR 1=1 --'");
  });
});

describe('names', () => {
  it('formats makes', () => {
    expect(displayMake('VOLKSWAGEN')).toBe('Volkswagen');
    expect(displayMake('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(displayMake('LAND ROVER')).toBe('Land Rover');
    expect(displayMake('BMW')).toBe('BMW');
    expect(displayMake('CITROEN')).toBe('Citroën');
  });

  it('formats models', () => {
    expect(displayModel('GOLF')).toBe('Golf');
    expect(displayModel('320I')).toBe('320i');
    expect(displayModel('MODEL 3')).toBe('Model 3');
    expect(displayModel('ID.3')).toBe('ID.3');
    expect(displayModel('C-HR')).toBe('C-HR');
  });

  it('groups model spellings and strips the make prefix', () => {
    const models = groupModels('TOYOTA', [
      { model: 'YARIS', n: '100' },
      { model: 'TOYOTA YARIS', n: '50' },
      { model: 'C-HR', n: '10' },
    ]);
    expect(models[0]).toMatchObject({ key: 'YARIS', count: 150, rawNames: ['YARIS', 'TOYOTA YARIS'] });
    expect(filterModels(models, 'c-h')[0].key).toBe('CHR');
  });

  it('finds makes by prefix and splits "make model" queries', () => {
    expect(searchMakes('volks')[0].rdw).toBe('VOLKSWAGEN');
    expect(searchMakes('merc')[0].rdw).toBe('MERCEDES-BENZ');
    expect(splitMakeQuery('volkswagen go')).toMatchObject({ make: { rdw: 'VOLKSWAGEN' }, rest: 'go' });
    expect(splitMakeQuery('Land Rover def')).toMatchObject({ make: { rdw: 'LAND ROVER' }, rest: 'def' });
    expect(splitMakeQuery('volkswag')).toBeNull();
  });
});

describe('median', () => {
  it('handles odd/even/empty', () => {
    expect(median([5.9, 5.1, 6.3])).toBe(5.9);
    expect(median([5, 6, 7, 8])).toBe(6.5);
    expect(median([])).toBeUndefined();
  });
});

describe('classifyCar', () => {
  it('petrol with WLTP figure', () => {
    expect(classifyCar([row({ brandstof_omschrijving: 'Benzine', brandstof_verbruik_gecombineerd_wltp: '5.400', nettomaximumvermogen: '81.00' })])).toEqual({
      energy: 'petrol',
      pricedFuel: 'petrol',
      powerKw: 81,
      consumption: { value: 5.4, unit: 'L', method: 'wltp' },
    });
  });

  it('derives consumption from WLTP CO₂ when L/100 km is missing (mild hybrid Golf)', () => {
    const r = classifyCar([
      row({ brandstof_omschrijving: 'Elektriciteit', klasse_hybride_elektrisch_voertuig: 'NOVC-HEV' }),
      row({ brandstof_omschrijving: 'Benzine', emissie_co2_gecombineerd_wltp: '126', klasse_hybride_elektrisch_voertuig: 'NOVC-HEV' }),
    ]);
    expect(r).toMatchObject({ energy: 'hybrid', pricedFuel: 'petrol', consumption: { value: 5.5, method: 'co2' } });
  });

  it('diesel CO₂ uses the diesel factor', () => {
    const r = classifyCar([row({ brandstof_omschrijving: 'Diesel', emissie_co2_gecombineerd_wltp: '120' })]);
    expect(r?.consumption).toEqual({ value: 4.6, unit: 'L', method: 'co2' });
  });

  it('falls back to NEDC for older cars', () => {
    const r = classifyCar([row({ brandstof_omschrijving: 'Benzine', brandstofverbruik_gecombineerd: '5.0' })]);
    expect(r?.consumption).toEqual({ value: 5, unit: 'L', method: 'nedc' });
  });

  it('EV: Wh/km → kWh/100 km', () => {
    const r = classifyCar([row({ brandstof_omschrijving: 'Elektriciteit', elektrisch_verbruik_enkel_elektrisch_wltp: '147.00', netto_max_vermogen_elektrisch: '208.00' })]);
    expect(r).toEqual({ energy: 'ev', pricedFuel: 'electricity', powerKw: 208, consumption: { value: 14.7, unit: 'kWh', method: 'wltp' } });
  });

  it('PHEV ignores the weighted (full-battery) figure', () => {
    const r = classifyCar([
      row({ brandstof_omschrijving: 'Benzine', klasse_hybride_elektrisch_voertuig: 'OVC-HEV', brandstof_verbruik_gewogen_gecombineerd_wltp: '1.4' } as unknown as FuelRow),
      row({ brandstof_omschrijving: 'Elektriciteit', klasse_hybride_elektrisch_voertuig: 'OVC-HEV' }),
    ]);
    expect(r).toMatchObject({ energy: 'phev', pricedFuel: 'petrol' });
    expect(r?.consumption).toBeUndefined();
  });

  it('PHEV uses the charge-sustaining figure when present', () => {
    const r = classifyCar([row({ brandstof_omschrijving: 'Benzine', klasse_hybride_elektrisch_voertuig: 'OVC-HEV', brandstof_verbruik_gecombineerd_wltp: '7.600' })]);
    expect(r?.consumption).toEqual({ value: 7.6, unit: 'L', method: 'wltp' });
  });

  it('bi-fuel LPG is priced on LPG', () => {
    const r = classifyCar([
      row({ brandstof_omschrijving: 'Benzine', brandstofverbruik_gecombineerd: '6.0' }),
      row({ brandstof_omschrijving: 'LPG', brandstofverbruik_gecombineerd: '7.8' }),
    ]);
    expect(r).toMatchObject({ energy: 'lpg', pricedFuel: 'lpg', consumption: { value: 7.8 } });
  });

  it('ignores implausible values', () => {
    const r = classifyCar([row({ brandstof_omschrijving: 'Benzine', brandstof_verbruik_gecombineerd_wltp: '0.000', emissie_co2_gecombineerd_wltp: '0' })]);
    expect(r?.consumption).toBeUndefined();
  });

  it('returns null for unsupported fuels', () => {
    expect(classifyCar([row({ brandstof_omschrijving: 'Waterstof' })])).toBeNull();
    expect(classifyCar([])).toBeNull();
  });
});

describe('aggregateVariants', () => {
  const petrol = (cc: number, kw: number, value?: number) => ({
    cc,
    energy: { energy: 'petrol' as const, pricedFuel: 'petrol' as const, powerKw: kw, consumption: value ? { value, unit: 'L' as const, method: 'wltp' as const } : undefined },
  });

  it('groups by displacement + power with a median consumption', () => {
    const cars = [petrol(1498, 110, 5.6), petrol(1498, 110, 5.8), petrol(1498, 110, 6.0), petrol(999, 81, 5.2), petrol(999, 81, 5.4), petrol(999, 81)];
    const v = aggregateVariants(cars);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ label: '1.5 Benzine', sublabel: '110 kW · 150 pk', count: 3, consumption: { value: 5.8, sampleSize: 3 } });
    expect(v[1]).toMatchObject({ label: '1.0 Benzine', count: 3, consumption: { value: 5.3, sampleSize: 2 } });
  });

  it('shows every engine when no group is common (few cars for this model/year)', () => {
    const v = aggregateVariants([petrol(1498, 110, 5.6), petrol(1498, 110, 5.7), petrol(1984, 221, 7.5), petrol(999, 81, 5.2)]);
    expect(v.map((x) => x.count)).toEqual([2, 1, 1]);
  });

  it('drops rare one-off groups but keeps a single-group result', () => {
    expect(aggregateVariants([petrol(1498, 110, 5.6), petrol(1498, 110, 5.6), petrol(1498, 110, 5.6), petrol(1984, 221, 7.5)])).toHaveLength(1);
    expect(aggregateVariants([petrol(1984, 221, 7.5)])).toHaveLength(1);
  });

  it('reports null consumption when no car in the group has one', () => {
    expect(aggregateVariants([petrol(1395, 110), petrol(1395, 110), petrol(1395, 110)])[0].consumption).toBeNull();
  });
});

describe('lookupPlate', () => {
  it('builds a vehicle from the two RDW datasets', async () => {
    const { fetchFn, calls } = fakeFetch(
      [{ kenteken: 'HPV60X', merk: 'VOLKSWAGEN', handelsbenaming: 'GOLF', datum_eerste_toelating: '20220103', cilinderinhoud: '1498' }],
      [{ kenteken: 'HPV60X', brandstof_omschrijving: 'Benzine', nettomaximumvermogen: '96.00', emissie_co2_gecombineerd_wltp: '126' }],
    );
    const v = await lookupPlate('hpv-60-x', { fetchFn });
    expect(calls[0]).toContain('kenteken=HPV60X');
    expect(v).toMatchObject({ make: 'Volkswagen', model: 'Golf', year: 2022, energy: 'petrol', plate: 'HPV60X', consumption: { value: 5.5, source: 'rdw', method: 'co2' } });
  });

  it('rejects plates that are not passenger cars', async () => {
    const { fetchFn } = fakeFetch([{ kenteken: 'VBX12Z', merk: 'DAF', voertuigsoort: 'Bedrijfsauto' }], [{ brandstof_omschrijving: 'Diesel' }]);
    await expect(lookupPlate('VBX12Z', { fetchFn })).rejects.toBeInstanceOf(UnsupportedVehicleError);
  });

  it('throws not-found for an unknown plate', async () => {
    const { fetchFn } = fakeFetch([], []);
    await expect(lookupPlate('AB123C', { fetchFn })).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('rejects malformed plates without calling the API', async () => {
    const { fetchFn, calls } = fakeFetch();
    await expect(lookupPlate('AB1', { fetchFn })).rejects.toMatchObject({ kind: 'not-found' });
    expect(calls).toHaveLength(0);
  });
});
