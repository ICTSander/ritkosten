import { calculatePublicTransportCost } from '../fare/engine';
import { FARE_DATA_2026, nsRow } from '../fare/tariffs';
import { nearestStationIndex, nsTariffUnits, stationCode, unitsBetween } from '../fare/tariffUnits';
import { mapMotisItinerary } from '../../services/transit/transitous';
import fixture from '../../services/__tests__/fixtures/transitous-heerlen-amsterdam.json';

const HEERLEN = { lat: 50.89111, lon: 5.974481 };
const AMSTERDAM_C = { lat: 52.3788, lon: 4.9004 };
const SITTARD = { lat: 51.00237, lon: 5.85717 };
const UTRECHT_C = { lat: 52.0894, lon: 5.1101 };

describe('official NS tariff units (open data)', () => {
  it('matches stations by coordinates', () => {
    expect(stationCode(nearestStationIndex(HEERLEN.lat, HEERLEN.lon))).toBe('HRL');
    expect(stationCode(nearestStationIndex(AMSTERDAM_C.lat, AMSTERDAM_C.lon))).toBe('ASD');
    expect(nearestStationIndex(53.5, 3.0)).toBe(-1); // North Sea
  });

  it('returns the published units (symmetric)', () => {
    expect(nsTariffUnits(HEERLEN, AMSTERDAM_C)).toBe(215);
    expect(nsTariffUnits(AMSTERDAM_C, HEERLEN)).toBe(215);
    expect(nsTariffUnits(HEERLEN, SITTARD)).toBe(19);
    expect(nsTariffUnits(UTRECHT_C, AMSTERDAM_C)).toBe(39);
    expect(unitsBetween(5, 5)).toBe(0);
    expect(unitsBetween(-1, 5)).toBeUndefined();
  });
});

describe('fare engine with official units (recorded Transitous journeys)', () => {
  const [direct, viaSittard] = fixture.itineraries.map((it, i) => mapMotisItinerary(it as never, i));

  it('direct NS Intercity Heerlen → Amsterdam C is exact: 215 TE → capped 200 → € 33,30', () => {
    const q = calculatePublicTransportCost(direct, { product: 'none' }, FARE_DATA_2026);
    expect(q).toMatchObject({ finalCents: 3330, isEstimate: false });
  });

  it('Arriva leg stays an estimate; the NS part uses official units (Sittard → Amsterdam = 196 TE)', () => {
    const q = calculatePublicTransportCost(viaSittard, { product: 'none' }, FARE_DATA_2026);
    expect(q.lines[0]).toMatchObject({ fullCents: nsRow(FARE_DATA_2026.ns, 19)[1], isEstimate: true });
    expect(q.lines[1]).toMatchObject({ fullCents: nsRow(FARE_DATA_2026.ns, 196)[1], isEstimate: false });
    expect(q.isEstimate).toBe(true);
  });
});
