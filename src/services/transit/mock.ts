/**
 * DEVELOPMENT-ONLY mock planner. Registered only when EXPO_PUBLIC_TRANSIT_MOCK=1 AND __DEV__.
 * Every result is clearly labelled as fake ("Voorbeeldreis") so it can never be mistaken for
 * a real timetable. Useful for offline UI work and tests.
 */
import type { TransitItinerary } from '../../domain/transit';
import type { PublicTransportProvider } from './types';

export function mockItinerary(fromName: string, toName: string, startMs: number): TransitItinerary {
  const iso = (m: number) => new Date(startMs + m * 60_000).toISOString();
  const stop = (name: string) => ({ name, lat: 0, lon: 0 });
  return {
    id: `mock:${startMs}`,
    providerId: 'mock',
    departure: iso(0),
    arrival: iso(60),
    durationMin: 60,
    transfers: 1,
    realtime: false,
    legs: [
      { mode: 'walk', from: stop(fromName), to: stop('Voorbeeldhalte'), plannedDeparture: iso(0), plannedArrival: iso(5), departure: iso(0), arrival: iso(5), realtime: false, cancelled: false, distanceMeters: 400, durationMin: 5, intermediateStops: 0 },
      { mode: 'bus', line: '0', operator: 'Voorbeeld', from: stop('Voorbeeldhalte'), to: stop('Voorbeeldstation'), plannedDeparture: iso(8), plannedArrival: iso(18), departure: iso(8), arrival: iso(18), realtime: false, cancelled: false, distanceMeters: 5000, durationMin: 10, intermediateStops: 4 },
      { mode: 'train', line: 'Voorbeeldtrein', operator: 'NS', from: stop('Voorbeeldstation'), to: stop(toName), plannedDeparture: iso(22), plannedArrival: iso(60), departure: iso(22), arrival: iso(60), realtime: false, cancelled: false, distanceMeters: 40_000, durationMin: 38, intermediateStops: 3 },
    ],
  };
}

export const mockTransit: PublicTransportProvider = {
  id: 'mock',
  label: 'Voorbeeldreis (ontwikkelmodus)',
  attribution: { text: 'Voorbeelddata — geen echte dienstregeling', url: 'https://transitous.org' },
  capabilities: { realtime: false, fares: false, doorToDoor: true },
  availability: () => ({ status: 'available' }),
  plan: async () => ({ itineraries: [mockItinerary('Start', 'Bestemming', Date.now() + 5 * 60_000)] }),
};
