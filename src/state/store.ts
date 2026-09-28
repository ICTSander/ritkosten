/**
 * App state (Zustand, persisted in AsyncStorage).
 *
 * Privacy: we never persist the device position. Only places the user explicitly chose as a
 * destination or manual start point are stored (coordinates rounded to ~1 m).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_TRANSIT_PROFILE, type TransitProfile } from '../domain/fare/products';
import type { TimeQuery, TransitItinerary } from '../domain/transit';
import type { Place, PricedFuel, Vehicle } from '../domain/types';
import type { ChargingMode } from '../services/fuelPrices';

export interface RecentDestination {
  place: Place;
  usedAt: number;
  /** One-way car cost last time (cents). */
  lastCostCents?: number;
  /** One-way OV price last time (cents), with the user's discount. */
  lastTransitCents?: number;
}

/** 'ask' = not asked yet; 'device' = use GPS; 'manual' = user types a start point. */
export type StartMode = 'ask' | 'device' | 'manual';

export type Appearance = 'system' | 'light' | 'dark';

export interface AppState {
  hydrated: boolean;
  vehicle: Vehicle | null;
  chargingMode: ChargingMode;
  /** User-entered prices (only used when set). */
  priceOverrides: Partial<Record<PricedFuel, number>>;
  startMode: StartMode;
  manualStart: Place | null;
  recents: RecentDestination[];
  transitProfile: TransitProfile;
  appearance: Appearance;
  /** True once the user answered (or skipped) the OV discount question. */
  transitProfileAsked: boolean;
  /** In-memory only: the trip currently being calculated. */
  destination: Place | null;
  /** In-memory only: "Vertrek nu / om / Aankomst om". */
  timeQuery: TimeQuery;
  /** In-memory only: the OV journey opened in the detail screen. */
  selectedItinerary: TransitItinerary | null;

  setVehicle: (v: Vehicle) => void;
  setConsumption: (value: number) => void;
  setChargingMode: (m: ChargingMode) => void;
  setPriceOverride: (fuel: PricedFuel, price: number | null) => void;
  setStartMode: (m: StartMode) => void;
  setManualStart: (p: Place | null) => void;
  setDestination: (p: Place | null) => void;
  rememberTrip: (p: Place, costs: { carCents?: number; transitCents?: number }) => void;
  setTransitProfile: (p: TransitProfile) => void;
  setAppearance: (a: Appearance) => void;
  setTimeQuery: (t: TimeQuery) => void;
  setSelectedItinerary: (it: TransitItinerary | null) => void;
  removeRecent: (id: string) => void;
  clearRecents: () => void;
  resetAll: () => void;
}

const MAX_RECENTS = 8;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
const sanitizePlace = (p: Place): Place => ({ ...p, lat: round5(p.lat), lon: round5(p.lon) });

export function addRecent(
  list: RecentDestination[],
  place: Place,
  costs: { carCents?: number; transitCents?: number } = {},
  now = Date.now(),
): RecentDestination[] {
  if (place.kind === 'current-location') return list;
  const previous = list.find((r) => r.place.id === place.id);
  const rest = list.filter((r) => r.place.id !== place.id);
  return [
    {
      place: sanitizePlace(place),
      usedAt: now,
      lastCostCents: costs.carCents ?? previous?.lastCostCents,
      lastTransitCents: costs.transitCents ?? previous?.lastTransitCents,
    },
    ...rest,
  ].slice(0, MAX_RECENTS);
}

const initial = {
  vehicle: null,
  chargingMode: 'home' as ChargingMode,
  priceOverrides: {},
  startMode: 'ask' as StartMode,
  manualStart: null,
  recents: [],
  transitProfile: DEFAULT_TRANSIT_PROFILE,
  appearance: 'system' as Appearance,
  transitProfileAsked: false,
  destination: null,
  timeQuery: { kind: 'now' } as TimeQuery,
  selectedItinerary: null,
};

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      hydrated: false,
      ...initial,
      setVehicle: (vehicle) => set({ vehicle }),
      setConsumption: (value) =>
        set((s) =>
          s.vehicle
            ? {
                vehicle: {
                  ...s.vehicle,
                  consumption: { value, unit: s.vehicle.pricedFuel === 'electricity' ? 'kWh' : 'L', source: 'user', method: 'user' },
                },
              }
            : s,
        ),
      setChargingMode: (chargingMode) => set({ chargingMode }),
      setPriceOverride: (fuel, price) =>
        set((s) => {
          const next = { ...s.priceOverrides };
          if (price === null) delete next[fuel];
          else next[fuel] = price;
          return { priceOverrides: next };
        }),
      setStartMode: (startMode) => set({ startMode }),
      setManualStart: (p) => set({ manualStart: p ? sanitizePlace(p) : null }),
      setDestination: (destination) => set({ destination }),
      rememberTrip: (place, costs) => set((s) => ({ recents: addRecent(s.recents, place, costs) })),
      setTransitProfile: (transitProfile) => set({ transitProfile, transitProfileAsked: true }),
      setAppearance: (appearance) => set({ appearance }),
      setTimeQuery: (timeQuery) => set({ timeQuery }),
      setSelectedItinerary: (selectedItinerary) => set({ selectedItinerary }),
      removeRecent: (id) => set((s) => ({ recents: s.recents.filter((r) => r.place.id !== id) })),
      clearRecents: () => set({ recents: [] }),
      resetAll: () => set({ ...initial }),
    }),
    {
      name: 'ritkosten-state',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        vehicle: s.vehicle,
        chargingMode: s.chargingMode,
        priceOverrides: s.priceOverrides,
        startMode: s.startMode,
        manualStart: s.manualStart,
        recents: s.recents,
        transitProfile: s.transitProfile,
        transitProfileAsked: s.transitProfileAsked,
        appearance: s.appearance,
      }),
      // v1 → v2: keep car, settings and recents; add the OV profile. Unknown shapes reset.
      migrate: (persisted, version) => {
        if (version === 1 && persisted && typeof persisted === 'object') {
          return { ...initial, ...(persisted as object), transitProfile: DEFAULT_TRANSIT_PROFILE, transitProfileAsked: false };
        }
        return { ...initial };
      },
      onRehydrateStorage: () => () => {
        useApp.setState({ hydrated: true });
      },
    },
  ),
);
