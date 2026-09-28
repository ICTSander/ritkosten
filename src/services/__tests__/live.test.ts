/**
 * @jest-environment node
 *
 * Live contract tests against the real public APIs. Skipped unless LIVE=1 (`npm run test:live`),
 * so CI stays deterministic while we can still detect upstream changes.
 */
import { fetchCbsElectricityPrice, fetchCbsPumpPrice } from '../fuelPrices';
import { reverseGeocode, searchPlaces } from '../geocoding';
import { fetchModels, fetchVariants, fetchYears, lookupPlate, MAKES } from '../rdw';
import { getRoute } from '../routing';
import { transitous } from '../transit/transitous';
import { calculatePublicTransportCost } from '../../domain/fare/engine';
import { FARE_DATA_2026 } from '../../domain/fare/tariffs';
import { formatNlClock } from '../../domain/nlTime';

const live = process.env.LIVE ? describe : describe.skip;
jest.setTimeout(60_000);

live('live APIs', () => {
  it('CBS pump prices', async () => {
    for (const fuel of ['petrol', 'diesel', 'lpg'] as const) {
      const p = await fetchCbsPumpPrice(fuel);
      console.log(fuel, p.pricePerUnit, p.observedAt, p.methodLabel);
      expect(p.pricePerUnit).toBeGreaterThan(0.3);
    }
  });

  it('CBS electricity prices', async () => {
    for (const mode of ['home', 'public'] as const) {
      const p = await fetchCbsElectricityPrice(mode);
      console.log(mode, p.pricePerUnit, p.methodLabel);
      expect(p.pricePerUnit).toBeGreaterThan(0.05);
    }
  });

  it('RDW make → model → year → variants', async () => {
    const vw = MAKES.find((m) => m.rdw === 'VOLKSWAGEN')!;
    const models = await fetchModels(vw.rdw);
    const golf = models.find((m) => m.key === 'GOLF')!;
    console.log('models', models.slice(0, 8).map((m) => `${m.display} (${m.rawNames.join('|')})`));
    const years = await fetchYears(vw.rdw, golf);
    console.log('years', years.slice(0, 8));
    const t = Date.now();
    const variants = await fetchVariants(vw.rdw, golf, 2022);
    console.log(`variants (${Date.now() - t} ms)`, variants.map((v) => `${v.label} ${v.sublabel} → ${v.consumption?.value} ${v.consumption?.unit} ${v.consumption?.method} n=${v.count}`));
    expect(variants.length).toBeGreaterThan(2);
  });

  it('RDW BMW + Tesla variants', async () => {
    for (const [make, key, year] of [['BMW', '320I', 2021], ['TESLA', 'MODEL3', 2022], ['TOYOTA', 'YARIS', 2023]] as const) {
      const models = await fetchModels(make);
      const model = models.find((m) => m.key === key);
      console.log(make, key, model?.rawNames);
      const variants = await fetchVariants(make, model!, year);
      console.log(variants.slice(0, 5).map((v) => `${v.label} ${v.sublabel} → ${v.consumption?.value} ${v.consumption?.unit} ${v.consumption?.method}`));
    }
  });

  it('RDW plate lookup', async () => {
    for (const plate of ['HPV-60-X', 'GZS88K', 'ZV960G']) {
      const v = await lookupPlate(plate);
      console.log(plate, v);
    }
  });

  it('geocoding + routing', async () => {
    for (const q of ['Amsterdam', 'Rijksmuseum', 'Damrak 1 Amsterdam', 'Maastricht']) {
      const r = await searchPlaces(q);
      console.log(q, r.failed, r.places.slice(0, 4).map((p) => `${p.label} | ${p.detail} | ${p.source}`));
    }
    const route = await getRoute({ lat: 50.849, lon: 5.691 }, { lat: 52.3598, lon: 4.885 });
    console.log('route', route);
    expect(route.distanceKm).toBeGreaterThan(190);
    console.log('reverse', await reverseGeocode(50.8882, 5.9795));
  });

  it('Transitous door-to-door + fare engine', async () => {
    const r = await transitous.plan({ lat: 50.8882, lon: 5.9795 }, { lat: 52.3791, lon: 4.9003 }, { kind: 'now' });
    expect(r.itineraries.length).toBeGreaterThan(0);
    for (const it of r.itineraries.slice(0, 3)) {
      const q = calculatePublicTransportCost(it, { product: 'none' }, FARE_DATA_2026);
      const s = calculatePublicTransportCost(it, { product: 'student-weekend' }, FARE_DATA_2026);
      console.log(formatNlClock(it.departure), '→', formatNlClock(it.arrival), it.durationMin, 'min', it.transfers, 'x',
        it.legs.map((l) => `${l.mode}:${l.line ?? ''}:${l.operator ?? ''}:${Math.round((l.distanceMeters ?? 0) / 100) / 10}km`).join(' | '),
        'vol', q.finalCents, 'student-weekend', s.finalCents, q.lines.map((x) => x.label));
    }
  });
});
