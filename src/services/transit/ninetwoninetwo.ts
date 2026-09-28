/**
 * 9292 Reisadvies API — the official, licensed Dutch door-to-door planner (incl. fares + realtime).
 * Access requires a contract with 9292 ("Usage … is prohibited without the approval of 9292"),
 * a per-request billed token (must live on a server) and mandatory 9292 logo placement.
 * https://9292.nl/zakelijk/9292-reisadvies-api
 *
 * TODO(licence): once a contract exists, implement `plan` against our server proxy
 * (`${EXPO_PUBLIC_API_BASE_URL}/9292/journeys`) and map `fareInfo` into the fare engine.
 * Until then this provider reports itself unavailable. Never call unofficial 9292 endpoints.
 */
import { AppError } from '../http';
import type { PublicTransportProvider } from './types';

export const ninetwoninetwo: PublicTransportProvider = {
  id: '9292',
  label: '9292',
  attribution: { text: 'Reisadvies: 9292', url: 'https://9292.nl' },
  capabilities: { realtime: true, fares: true, doorToDoor: true },
  availability: () => ({
    status: 'unavailable',
    reason: 'no-licence',
    message: '9292 vereist een licentie. Nog niet gekoppeld.',
  }),
  plan: async () => {
    throw new AppError('provider', '9292: not licensed', '9292');
  },
};
