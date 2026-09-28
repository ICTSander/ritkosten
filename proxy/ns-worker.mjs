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

const NS_JOURNEY = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2/journey';
const NS_VIRTUAL_TRAIN = 'https://gateway.apiportal.ns.nl/virtual-train-api/api/v1/trein';
const NS_VEHICLES = 'https://gateway.apiportal.ns.nl/virtual-train-api/api/vehicle';
const DOUBLE_DECK = /^(VIRM|DDZ|DDAR|DD-AR|MDDM|NID)/i;
const ALLOWED_IMAGE_HOST = 'https://vt.ns-mlab.nl/';
const FACILITY_ORDER = ['WIFI', 'STROOM', 'STILTE', 'TOILET', 'FIETS', 'TOEGANKELIJK'];

// ---- Protecting the free NS key (300 requests / 5 min for ALL users together) ----------------
// Per-isolate memory: approximate, but it keeps us well under NS's limit in practice.
const NS_BUDGET = 270; // leave headroom under 300
const WINDOW_MS = 5 * 60_000;
let budget = { start: 0, used: 0 };
const cache = new Map(); // url → { at, data }
const CACHE_MS = 60_000;

function takeBudget() {
  const now = Date.now();
  if (now - budget.start > WINDOW_MS) budget = { start: now, used: 0 };
  if (budget.used >= NS_BUDGET) return false;
  budget.used++;
  return true;
}

async function nsGet(url, env, maxAgeMs = CACHE_MS) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  if (!takeBudget()) {
    if (hit) return hit.data; // serve stale rather than exceed NS's limit
    throw new Error('ns budget');
  }
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': env.NS_API_KEY } });
  if (!res.ok) throw new Error(`ns ${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

// Simple per-client limit against abuse: 60 requests per minute per IP.
const perIp = new Map();
function allowClient(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Date.now();
  const e = perIp.get(ip);
  if (!e || now - e.start > 60_000) {
    perIp.set(ip, { start: now, n: 1 });
    if (perIp.size > 5000) perIp.clear();
    return true;
  }
  e.n++;
  return e.n <= 60;
}

/**
 * Train details for one NS ride (ritnummer), seen from the boarding station:
 * crowding, rolling stock, seats, facilities, "shorter train" and NS notes.
 * Combines Reisinformatie /v2/journey and the Virtual Train API. Partial data is fine.
 * Train images (vt.ns-mlab.nl) are passed on because the app owner asked for them. NOTE: they show the
 * NS logo and the NS API terms forbid using NS logos — get written permission from NS before a public release.
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
    out.parts = v.lengte || out.parts;
    out.carriages = [];
    for (const m of v.materieeldelen || []) {
      out.carriages.push({
        type: m.type,
        image: typeof m.afbeelding === 'string' && m.afbeelding.startsWith(ALLOWED_IMAGE_HOST) ? m.afbeelding : undefined,
        width: m.breedte,
        height: m.hoogte,
      });
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

// Positions of all ~300 NS-tracked trains, shared for 10 s (one NS call serves every client).
let positions = { at: 0, data: null };

async function trainPosition(q, env) {
  const rit = (q.get('rit') || '').replace(/\D/g, '');
  if (!rit) return cors(JSON.stringify({ error: 'rit required' }), 400);
  if (!positions.data || Date.now() - positions.at > 10_000) {
    const all = await nsGet(NS_VEHICLES, env, 10_000);
    positions = { at: Date.now(), data: (all.payload && all.payload.treinen) || [] };
  }
  const t = positions.data.find((x) => String(x.treinNummer) === rit || String(x.ritId) === rit);
  if (!t) return cors(JSON.stringify({ error: 'no position' }), 404, { 'Cache-Control': 'no-store' });
  return cors(
    JSON.stringify({ rit, lat: t.lat, lon: t.lng, speedKmh: Math.round(t.snelheid || 0), heading: t.richting, at: new Date(positions.at).toISOString() }),
    200,
    { 'Cache-Control': 'public, max-age=10' },
  );
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(null, 204, { 'Access-Control-Allow-Methods': 'GET' });
    const url = new URL(request.url);
    if (url.pathname === '/health') return cors(JSON.stringify({ ok: true, ns: !!env.NS_API_KEY }), 200, { 'Cache-Control': 'no-store' });
    if (!env.NS_API_KEY) return cors(JSON.stringify({ error: 'NS_API_KEY not configured' }), 503);
    if (!allowClient(request)) return cors(JSON.stringify({ error: 'too many requests' }), 429, { 'Retry-After': '30' });
    try {
      return await route(url, env);
    } catch (e) {
      const busy = String(e && e.message).includes('budget');
      return cors(JSON.stringify({ error: busy ? 'busy' : 'ns unavailable' }), busy ? 503 : 502, busy ? { 'Retry-After': '60' } : {});
    }
  },
};

async function route(url, env) {
  if (url.pathname === '/ns/train') return trainInfo(url.searchParams, env);
  if (url.pathname === '/ns/position') return trainPosition(url.searchParams, env);
  if (url.pathname === '/health') return cors(JSON.stringify({ ok: true }), 200, { 'Cache-Control': 'no-store' });
  // /ns/trips (door-to-door planning) is not allowed with a free NS key, so it isn't offered.
  return cors(JSON.stringify({ error: 'not found' }), 404);
}
