# Ritkosten

**"Ik wil hierheen." → Auto: € 17,90 · OV: € 14,20 → Open in Google Maps / Bekijk reis**

A personal trip planner (Expo SDK 57 / React Native / TypeScript; iOS, Android, web) that compares, for one
destination, what the trip costs and takes **by car vs by public transport**. First time: pick your car
(licence plate or make/model), optionally your OV discount (studentenreisproduct, Dal Voordeel, …), allow
location. Every next time: type a destination — the app fetches the car route + fuel price and door-to-door
OV journeys + ticket prices automatically and shows a neutral comparison.

## Quick start

```bash
npm install
npm run web        # or: npm run ios / npm run android (Expo Go works: no custom native modules)
npm test           # 141 unit/integration tests (mocked HTTP + recorded fixtures)
npm run test:live  # contract tests against the real public APIs
npm run typecheck && npm run lint
```

**No API keys are needed.** All core data sources are free and keyless. See `.env.example` for the
optional ones.

## Data sources

The sources below were researched and verified with live requests in September 2026.

| What | Source | Key? | Notes |
|---|---|---|---|
| Car, fuel type, consumption | **RDW Open Data** (`m9d7-ebf2` vehicles, `8ys7-d773` fuel) | no (optional app token) | Official WLTP combined consumption. It is often empty, in which case we derive it from the official WLTP CO₂ figure (÷22.8 petrol, ÷25.9 diesel). Older cars use NEDC. Each variant shows the **median** over sampled registered cars. |
| Petrol / diesel / LPG price | **CBS StatLine 80416ned** | no | Daily **national average** pump price, weighted from real card transactions. CBS publishes weekly, so the newest day is usually 3–10 days old. The app always shows the date. |
| Electricity (EV) | **CBS 85592NED** (home tariff) / **84991NED** (public charging) | no | Monthly / quarterly averages. The user can choose home or public charging. |
| Address search | **PDOK Locatieserver** (NL addresses, places, postcodes) + **Photon** (POIs such as "Rijksmuseum", and addresses abroad) | no | Both are queried in parallel, then merged and de-duplicated. Nominatim is deliberately not used because its policy forbids autocomplete. |
| OV journeys (door-to-door) | **Transitous** (MOTIS, open GTFS data incl. OpenOV/NDOV) | no | Walk + bus/tram/metro/train legs, platforms, realtime delays, cancellations. **Policy: free for open-source, non-commercial use; attribution link to transitous.org/sources required; contact them before heavy use.** A commercial release needs 9292 or NS instead. |
| OV (optional) | **NS Reisinformatie API** via our proxy (`proxy/ns-worker.js`) | free NS key, **server-side only** | Realtime + official NS fares. Off until `EXPO_PUBLIC_API_BASE_URL` points to a deployed proxy. |
| OV (licensed) | **9292 Reisadvies API** | contract + token | Provider stub reports "licentie vereist"; never uses unofficial endpoints. |
| OV ticket prices | **NS Tarieven 2026** (full table, `src/data/ns-fares-2026.json`) + regional bus/tram tariffs (GVB, U-OV, indexed national rate) | no | Estimates (marked "≈"): tariff units ≈ rail km; BTM = €1,16 base + km-rate, no new base fare within 35 min between buses. Exact when the NS proxy returns the official fare. |
| Car → navigation | **Google Maps URLs** (`maps/dir/?api=1`) | no | Opens the Google Maps app/site; origin = device location, so we never send it. |
| Route distance | **FOSSGIS OSRM** → **FOSSGIS Valhalla** → **OSRM demo** → OpenRouteService (optional key) | no | We route once per destination, never while the user is typing. Points that snap >2 km to a road are rejected as "no route". |

There is **no free, legitimate station-level price API for the Netherlands**. The ANWB and
UnitedConsumers prices are not open, so the app uses the CBS national average and says so in the UI.
If CBS can't be reached, the app falls back to the last price it fetched, clearly marked. If there is
none, it asks the user for a price for this trip only. **It never uses a hard-coded price.**

### OV discount products (`src/domain/fare/products.ts`)

Rules are data, each with its official source (researched 2026-09-28):

| Product | Rule |
|---|---|
| Studentenreisproduct week | free Mon 04:00 – Sat 04:00; otherwise 40% train / 34% bus-tram-metro; 16 Jul – 16 Aug discount only |
| Studentenreisproduct weekend | free Fri 12:00 – Mon 04:00; weekdays 09:00–04:00 discount; 04:00–09:00 full fare |
| Dal Voordeel / Dal Vrij | 40% / free on **NS** trains off-peak (weekdays 09:00–16:00 & 18:30–06:30, weekends) |
| Altijd Vrij | free on NS trains |
| NS Flex basis, none | full fare |
| Andere korting | user % on trains |

Not modelled yet: public holidays, 1st class, surcharges (ICE/IC direct), night buses, cross-border trains.
Altijd Voordeel is not offered: NS discontinued it on 1 July 2026. To verify with an NS key: whether NS
discounts apply on other operators' trains (we assume not — conservative).

### Adding a country later

Fuel prices go through a per-country provider registry (`FUEL_PRICE_PROVIDERS` in
`src/services/fuelPrices.ts`). Researched candidates:

- **DE:** Tankerkönig (free key, station level)
- **FR:** prix-carburants (keyless)
- **AT:** E-Control (keyless)
- **EU fallback:** EU Weekly Oil Bulletin (xlsx, would need a small server-side converter)

Keyed providers should run behind a proxy (see Security).

## Architecture

```
src/
  app/            expo-router screens: car (onboarding 1/3), ready (2/3), ov-profile (3/3), index (home),
                  search (destination / start point), compare (car vs OV), journey (OV timeline), settings
  domain/         pure logic: calculation.ts, carCost.ts (extensible cost components), comparison.ts
                  (neutral wording), transit.ts, nlTime.ts (Dutch time without Intl), fare/ (engine,
                  products, tariffs), format.ts, types.ts
  services/       transit/ (PublicTransportProvider: transitous, ns-via-proxy, 9292 stub, dev mock;
                  registry with fallback), maps.ts (MapsNavigationProvider → Google Maps),
                  http.ts (timeout, retry/backoff, typed errors), rdw.ts, fuelPrices.ts,
                  priceService.ts (fallback chain), geocoding.ts, routing.ts, location.ts, cache.ts
  state/          store.ts (zustand + AsyncStorage, v2 with migration), compare.ts (start point, car
                  and OV load independently), hooks.ts (useAsyncResource, useFuelPrice, useOnline)
  ui/             theme tokens (light/dark), components, PlateInput, PriceCounter, NumberStepper
  data/           makes.json / models.json: RDW snapshots so search is instant (`npm run data:makes`,
                  `npm run data:models`). Models refresh live per make in the background.
```

### Calculation

`calculateTripCost` in `src/domain/calculation.ts`:

- `liters = km × L/100km ÷ 100`, then `cost = liters × price`.
- Rounds half-up only at the end. Binary float noise is stripped first, so 10.005 becomes €10.01.
- Returns integer cents.
- Return trip = exactly 2 × the rounded one-way cost, so the screen always adds up.
- Input is validated: no NaN, negative or absurd values.

## Edge cases handled

| Situation | Behaviour |
|---|---|
| Plate not found | Clear message, with a hint to search by make/model instead |
| Plate belongs to a van or motorbike | Says Ritkosten only covers passenger cars |
| Hydrogen or CNG car | Says the fuel isn't supported yet |
| Consumption unknown | Suggests the median of the same model's other variants ("Klopt het dat…?"). Otherwise asks the user. This only happens when it is truly needed. |
| PHEV | The RDW weighted figure (≈1–2 L, assumes a full battery) is ignored. The empty-battery figure is used when RDW has it, otherwise the user is asked. |
| Hybrid | Official figure used, no question asked |
| EV | kWh/100 km with the home or public charging price |
| Bi-fuel LPG | Priced on LPG |
| Location | Asked only when the first destination is picked, with a one-line reason. It can be refused, and the user then types a start point. The position is kept in memory only and never stored. Reverse geocoding sends a coarse (~1 km) position. |
| Offline, rate limit (429 + Retry-After), timeouts, 5xx | Retry with backoff, then a readable error with a retry button |
| Price missing or stale | Last known price shown with a date warning, or a one-trip manual price |
| No road route (sea, island) | "Geen route gevonden" |

## Train images

NS's Virtual Train API exposes rolling-stock images, but NS's API terms forbid using NS logos and say
nothing about showing their photos (which carry the NS livery/logo). We therefore draw our own generic
train illustration (double-deck for Intercity). Switch to NS images only with written permission from NS.

## Security & privacy

- **Anything prefixed `EXPO_PUBLIC_` ends up in the app bundle and is public.**
  - The optional RDW app token is not a secret.
  - For production, move an OpenRouteService or Tankerkönig key behind a small server proxy (for example an Expo Router API route on EAS Hosting). Never ship those keys in the client.
- `.env` is git-ignored. Only `.env.example` is committed.
- The NS key and a future 9292 token live only on the proxy (`NS_API_KEY`), never in `EXPO_PUBLIC_*`.
- The device position is sent only to the routing/planning services (Valhalla/OSRM, Transitous) to
  compute the trip, and at ~1 km precision to Photon for the town name. It is never stored.
- Stored locally:
  - the chosen car
  - settings
  - destinations the user picked (max 8, coordinates rounded)
  - a manual start point
- "Alle gegevens wissen" in settings clears everything.

## Known limitations

- **Prices:** the fuel price is a national average, not your local station's price.
- **Consumption:** WLTP is an official test figure. Real-world use is usually somewhat higher. The UI calls the result an estimate and lists the factors that affect it.
- **Ferries:** crossings count as driving distance.
- **OV prices** are estimates unless the NS proxy is active; BTM regional rates outside Amsterdam/Utrecht
  use the indexed national example rate.
- **Transitous** is a community service for non-commercial use; plan a 9292 contract or NS for production.
- **Engine names:** RDW has no trim names like "1.5 TSI", so variants are shown as displacement + fuel + power (e.g. "1.5 Benzine · 110 kW · 150 pk").
- **Public servers:** the free routing and geocoding servers are best-effort, fair-use services. At real user volumes, self-host Photon/OSRM or move to paid tiers. Only the routing and geocoding provider modules need to change.
