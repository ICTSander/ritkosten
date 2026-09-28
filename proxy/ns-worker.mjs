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
 *
 * NOTE (tested 2026-09-28): a free key may NOT plan door-to-door trips (error
 * API_KEY_NOT_ALLOWED_TO_PLAN_DOOR_TO_DOOR). The app therefore plans with Transitous and uses NS
 * only for train details via /ns/train (journey + virtual train, both allowed with the free key).
 */

const NS_TRIPS = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v3/trips';
const NS_JOURNEY = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2/journey';
const NS_VIRTUAL_TRAIN = 'https://gateway.apiportal.ns.nl/virtual-train-api/api/v1/trein';
const DOUBLE_DECK = /^(VIRM|DDZ|DDAR|DD-AR|MDDM|NID)/i;
const FACILITY_ORDER = ['WIFI', 'STROOM', 'STILTE', 'TOILET', 'FIETS', 'TOEGANKELIJK'];

async function nsGet(url, env) {
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': env.NS_API_KEY } });
  if (!res.ok) throw new Error(`ns ${res.status}`);
  return res.json();
}

/**
 * Train details for one NS ride (ritnummer), seen from the boarding station:
 * crowding, rolling stock, seats, facilities, "shorter train" and NS notes.
 * Combines Reisinformatie /v2/journey and the Virtual Train API. Partial data is fine.
 * NS train IMAGES are deliberately not passed on: they show the NS logo, which the NS API terms forbid us to use.
 */
async function trainInfo(q, env) {
  const rit = (q.get('rit') || '').replace(/\D/g, '');
  const station = (q.get('station') || '').toUpperCase().replace(/[^A-Z]/g, '');
  const dateTime = q.get('dateTime') || '';
  if (!rit) return cors(JSON.stringify({ error: 'rit required' }), 400);
  const dt = dateTime ? `&dateTime=${encodeURIComponent(dateTime)}` : '';

  const [journey, vt] = await Promise.allSettled([
    nsGet(`${NS_JOURNEY}?train=${rit}&omitCrowdForecast=false${dt}`, env),
    nsGet(`${NS_VIRTUAL_TRAIN}/${rit}${station ? `/${station}` : ''}?features=zitplaats,drukte${dt}`, env),
  ]);

  const out = { ritnummer: rit, facilities: [], notes: [] };
  if (journey.status === 'fulfilled') {
    const p = journey.value.payload || {};
    const stops = p.stops || [];
    const board =
      stops.find((s) => station && (s.id || '').toUpperCase().startsWith(station)) ||
      stops.find((s) => s.departures && s.departures[0] && s.departures[0].crowdForecast) ||
      stops[0];
    const dep = board && board.departures && board.departures[0];
    if (dep) {
      out.crowd = dep.crowdForecast && dep.crowdForecast !== 'UNKNOWN' ? dep.crowdForecast : undefined;
      out.category = dep.product && dep.product.longCategoryName;
      out.cancelled = !!dep.cancelled;
      if (dep.delayInSeconds) out.delayMin = Math.round(dep.delayInSeconds / 60);
    }
    const stock = board && (board.actualStock || board.plannedStock);
    if (stock) {
      out.trainType = stock.trainType;
      out.parts = stock.numberOfParts;
      out.seats = stock.numberOfSeats;
      for (const tp of stock.trainParts || []) out.facilities.push(...(tp.facilities || []));
    }
    for (const n of p.notes || []) if (n && (n.text || n.value)) out.notes.push(n.text || n.value);
  }
  if (vt.status === 'fulfilled') {
    const v = vt.value;
    out.trainType = out.trainType || v.type;
    out.shortened = !!v.ingekort;
    out.lengthM = v.lengteInMeters;
    if (v.lengte && !out.parts) out.parts = v.lengte;
    let first = 0;
    let second = 0;
    let bikes = 0;
    for (const m of v.materieeldelen || []) {
      const z = m.zitplaatsen || {};
      first += (z.zitplaatsEersteKlas || 0) + (z.klapstoelEersteKlas || 0);
      second += (z.zitplaatsTweedeKlas || 0) + (z.klapstoelTweedeKlas || 0);
      bikes += z.fietsplekken || 0;
      out.facilities.push(...(m.faciliteiten || []));
    }
    if (first + second > 0) {
      out.seatsFirst = first;
      out.seatsSecond = second;
    }
    if (bikes) out.bikeSpots = bikes;
    const letters = (v.perronVoorzieningen || []).filter((x) => x.type === 'PERRONLETTER').map((x) => x.description);
    if (letters.length) out.platformSections = `${letters[letters.length - 1]}–${letters[0]}`;
  }
  const facilities = [...new Set(out.facilities.map((f) => String(f).toUpperCase()))];
  out.facilities = FACILITY_ORDER.filter((f) => facilities.includes(f));
  out.doubleDeck = out.trainType ? DOUBLE_DECK.test(out.trainType) : undefined;
  if (journey.status === 'rejected' && vt.status === 'rejected') return cors(JSON.stringify({ error: 'no train info' }), 502);
  return cors(JSON.stringify(out));
}
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
    if (!env.NS_API_KEY) return cors(JSON.stringify({ error: 'NS_API_KEY not configured' }), 503);
    if (url.pathname === '/ns/train') return trainInfo(url.searchParams, env);
    if (url.pathname !== '/ns/trips') return cors(JSON.stringify({ error: 'not found' }), 404);

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
