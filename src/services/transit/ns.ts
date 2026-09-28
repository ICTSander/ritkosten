/**
 * NS Reisinformatie API (https://apiportal.ns.nl, free key, header Ocp-Apim-Subscription-Key).
 *
 * The key must NEVER ship in the app bundle. This provider talks to our own proxy
 * (`EXPO_PUBLIC_API_BASE_URL`, see /proxy) which adds the key server-side and returns trips
 * already mapped to our TransitItinerary shape. Without a proxy it reports "unavailable",
 * and the app falls back to Transitous + the fare engine.
 *
 * TODO(ns-key): register at apiportal.ns.nl, deploy /proxy with NS_API_KEY, set
 * EXPO_PUBLIC_API_BASE_URL. Then verify the trip/fare fields against the official OpenAPI spec.
 */
import type { TimeQuery, TransitItinerary } from '../../domain/transit';
import { fetchJson } from '../http';
import type { LatLon, PublicTransportProvider } from './types';

export const apiBaseUrl = () => process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || '';

export const nsProxy: PublicTransportProvider = {
  id: 'ns',
  label: 'NS',
  attribution: { text: 'Reisinformatie: NS', url: 'https://apiportal.ns.nl' },
  capabilities: { realtime: true, fares: true, doorToDoor: false },
  availability: () =>
    apiBaseUrl()
      ? { status: 'available' }
      : { status: 'unavailable', reason: 'no-proxy', message: 'NS-koppeling niet ingesteld (server met NS-key nodig).' },
  // Not used for planning (free keys can't plan door-to-door); kept for a future paid/partner key.
  async plan(from: LatLon, to: LatLon, time: TimeQuery, opts = {}) {
    const params = new URLSearchParams({
      fromLat: String(from.lat),
      fromLon: String(from.lon),
      toLat: String(to.lat),
      toLon: String(to.lon),
      dateTime: time.kind === 'now' ? new Date().toISOString() : time.at,
      searchForArrival: String(time.kind === 'arrive'),
    });
    const data = await fetchJson<{ itineraries: TransitItinerary[] }>(`${apiBaseUrl()}/ns/trips?${params}`, {
      provider: 'ns',
      timeoutMs: 12_000,
      retries: 1,
      signal: opts.signal,
    });
    return { itineraries: data.itineraries ?? [] };
  },
};
