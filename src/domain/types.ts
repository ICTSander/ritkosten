export type CountryCode = 'NL' | 'BE' | 'DE' | 'FR' | 'AT' | 'LU';

/** How the car is powered. Drives which price + unit we use. */
export type EnergyType = 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'phev' | 'ev';

/** What we actually pay for at the pump / charger. */
export type PricedFuel = 'petrol' | 'diesel' | 'lpg' | 'electricity';

export type EnergyUnit = 'L' | 'kWh';

export interface Consumption {
  /** Per 100 km, in `unit`. */
  value: number;
  unit: EnergyUnit;
  source: 'rdw' | 'user';
  /**
   * wltp: official WLTP combined figure.
   * co2: derived from the official WLTP CO₂ figure (RDW often leaves the L/100 km field empty).
   * nedc: older, more optimistic test cycle (pre-2018 cars).
   */
  method: 'wltp' | 'co2' | 'nedc' | 'user';
  /** How many registered cars the RDW median is based on (only for source 'rdw'). */
  sampleSize?: number;
}

export interface Vehicle {
  make: string;
  model: string;
  year?: number;
  /** Human readable variant, e.g. "1.5 · 110 kW". */
  variantLabel?: string;
  engineCc?: number;
  powerKw?: number;
  energy: EnergyType;
  /** Which fuel we price the trip with (PHEV/hybrid → petrol unless user picks otherwise). */
  pricedFuel: PricedFuel;
  consumption: Consumption | null;
  plate?: string;
}

export interface FuelPrice {
  fuel: PricedFuel;
  pricePerUnit: number;
  unit: EnergyUnit;
  currency: 'EUR';
  country: CountryCode;
  /** Date the price applies to (ISO date) — NOT when we fetched it. */
  observedAt: string;
  fetchedAt: string;
  source: 'cbs' | 'user';
  method: 'national-average' | 'user-entered';
  /** Human readable description of the method, shown in the UI. */
  methodLabel: string;
}

export interface Place {
  id: string;
  label: string;
  /** Secondary line, e.g. "1012 LG Amsterdam" or "Museum · Amsterdam". */
  detail?: string;
  lat: number;
  lon: number;
  countryCode?: string;
  kind: 'address' | 'city' | 'postcode' | 'street' | 'poi' | 'station' | 'current-location';
  source: 'pdok' | 'photon' | 'device' | 'local';
}

export interface Route {
  distanceKm: number;
  durationMin?: number;
  source: 'fossgis-osrm' | 'fossgis-valhalla' | 'osrm-demo' | 'ors';
}
