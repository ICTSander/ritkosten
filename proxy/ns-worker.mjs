/**
 * Optional server-side proxy for the NS Reisinformatie API (Cloudflare Worker).
 * Keeps NS_API_KEY off the phone and maps NS trips to the app's TransitItinerary shape.
 *
 * Deploy:
 *   npx wrangler deploy proxy/ns-worker.mjs --name ritkosten-proxy
 *   npx wrangler secret put NS_API_KEY        # key from https://apiportal.ns.nl (free, "Ns-App" product)
 * Then set EXPO_PUBLIC_API_BASE_URL=https://ritkosten-proxy.<account>.workers.dev in the app.
 *
 * NS terms (https://www.ns.nl/binaries/content/assets/ns-nl/voorwaarden/overeenkomst-tot-gebruik-van-api.pdf):
 * only for informing travellers about journeys; never use NS logos; don't imply NS checked the data.
 *
 * Parameters and fields checked against the official Reisinformatie API spec (operation getTravelAdvice,
 * GET /api/v3/trips) on 2026-09-28: originLat/originLng, destinationLat/destinationLng, originWalk,
 * destinationWalk, dateTime, searchForArrival; Trip.legs/transfers/plannedDurationInMinutes/productFare
 * (TripTravelFare.priceInCents)/fareOptions.isTotalPriceUnknown; Leg.travelType/product/origin/destination/
 * stops/distanceInMeters/cancelled; TripOriginDestination.lat/lng/plannedDateTime/actualDateTime/…Track.
 * Rate limit for free users: 300 requests per 5 minutes → responses are cached for 60 s.
 */

const NS_TRIPS = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v3/trips';
const ALLOWED_ORIGIN = '*'; // tighten to your web domain in production

function cors(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Cache-Control': 'public, max-age=60',
      ...extra,
    },
  });
}

const MODE = { TRAIN: 'train', BUS: 'bus', TRAM: 'tram', METRO: 'metro', FERRY: 'ferry', WALK: 'walk' };

function mapLeg(l) {
  const walk = l.travelType === 'WALK';
  const o = l.origin || {};
  const d = l.destination || {};
  const dep = o.actualDateTime || o.plannedDateTime;
  const arr = d.actualDateTime || d.plannedDateTime;
  const delay = o.actualDateTime && o.plannedDateTime ? Math.round((Date.parse(o.actualDateTime) - Date.parse(o.plannedDateTime)) / 60000) : 0;
  return {
    mode: walk ? 'walk' : MODE[(l.product && l.product.type) || 'TRAIN'] || 'other',
    line: walk ? undefined : (l.product && (l.product.categoryCode || l.product.displayName)) || l.name,
    lineLong: l.product && l.product.longCategoryName,
    operator: l.product && l.product.operatorName,
    headsign: l.direction,
    from: { name: o.name || '', lat: o.lat, lon: o.lng, platform: o.actualTrack || o.plannedTrack, plannedPlatform: o.plannedTrack },
    to: { name: d.name || '', lat: d.lat, lon: d.lng, platform: d.actualTrack || d.plannedTrack, plannedPlatform: d.plannedTrack },
    plannedDeparture: o.plannedDateTime,
    plannedArrival: d.plannedDateTime,
    departure: dep,
    arrival: arr,
    realtime: !!o.actualDateTime,
    delayMin: delay || undefined,
    cancelled: !!l.cancelled,
    distanceMeters: l.distanceInMeters,
    durationMin: Math.round((Date.parse(arr) - Date.parse(dep)) / 60000),
    intermediateStops: Math.max(0, ((l.stops && l.stops.length) || 2) - 2),
    tripNumber: l.product && l.product.number,
  };
}

function mapTrip(t, i) {
  const legs = (t.legs || []).map(mapLeg);
  return {
    id: `ns:${t.ctxRecon || i}`,
    providerId: 'ns',
    legs,
    departure: legs[0] && legs[0].departure,
    arrival: legs[legs.length - 1] && legs[legs.length - 1].arrival,
    durationMin: t.actualDurationInMinutes || t.plannedDurationInMinutes,
    transfers: t.transfers || 0,
    realtime: legs.some((l) => l.realtime),
    // Only trust the price when NS itself knows the total (isTotalPriceUnknown = false).
    apiFullFareCents:
      t.productFare && !(t.fareOptions && t.fareOptions.isTotalPriceUnknown) ? t.productFare.priceInCents : undefined,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204, { 'Access-Control-Allow-Methods': 'GET' });
    const url = new URL(request.url);
    if (url.pathname !== '/ns/trips') return cors(JSON.stringify({ error: 'not found' }), 404);
    if (!env.NS_API_KEY) return cors(JSON.stringify({ error: 'NS_API_KEY not configured' }), 503);

    const q = url.searchParams;
    const num = (k) => Number(q.get(k));
    if (![num('fromLat'), num('fromLon'), num('toLat'), num('toLon')].every(Number.isFinite)) {
      return cors(JSON.stringify({ error: 'bad coordinates' }), 400);
    }
    const params = new URLSearchParams({
      originLat: q.get('fromLat'),
      originLng: q.get('fromLon'),
      destinationLat: q.get('toLat'),
      destinationLng: q.get('toLon'),
      dateTime: q.get('dateTime') || new Date().toISOString(),
      searchForArrival: q.get('searchForArrival') === 'true' ? 'true' : 'false',
      // Door-to-door: let NS add walking to/from the station.
      originWalk: 'true',
      destinationWalk: 'true',
      lang: 'nl',
    });
    const res = await fetch(`${NS_TRIPS}?${params}`, { headers: { 'Ocp-Apim-Subscription-Key': env.NS_API_KEY } });
    if (!res.ok) return cors(JSON.stringify({ error: `ns ${res.status}` }), res.status === 429 ? 429 : 502);
    const data = await res.json();
    return cors(JSON.stringify({ itineraries: (data.trips || []).map(mapTrip) }));
  },
};
