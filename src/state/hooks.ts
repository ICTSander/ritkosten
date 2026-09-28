import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isPriceStale } from '../services/fuelPrices';
import { isAbort } from '../services/http';
import { type ResolvedPrice, resolvePrice } from '../services/priceService';
import { useApp } from './store';

/** False only when we positively know there is no connection (unknown ≠ offline). */
export function useOnline(): boolean {
  const state = useNetworkState();
  if (state.isInternetReachable === false) return false;
  if (state.isConnected === false) return false;
  return true;
}

/** Debounced value (for search-as-you-type). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type Resource<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: unknown };

/**
 * Loads data for a key. Loading state is derived (the stored result belongs to an older key),
 * so there are no synchronous state resets inside effects, and stale responses are ignored:
 * changing the key aborts the previous request. `key === null` means idle.
 */
export function useAsyncResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): Resource<T> {
  const [result, setResult] = useState<{ key: string; ok: true; data: T } | { key: string; ok: false; error: unknown } | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((data) => setResult({ key, ok: true, data }))
      .catch((error) => {
        if (!isAbort(error) && !controller.signal.aborted) setResult({ key, ok: false, error });
      });
    return () => controller.abort();
  }, [key]);

  if (key === null) return { status: 'idle' };
  if (!result || result.key !== key) return { status: 'loading' };
  return result.ok ? { status: 'ok', data: result.data } : { status: 'error', error: result.error };
}

export type PriceState =
  | { status: 'loading' }
  | { status: 'ready'; resolved: ResolvedPrice; stale: boolean }
  | { status: 'error'; error: unknown };

/** Price for the current vehicle (respects user override + charging mode). */
export function useFuelPrice(): PriceState & { reload: () => void } {
  const fuel = useApp((s) => s.vehicle?.pricedFuel);
  const chargingMode = useApp((s) => s.chargingMode);
  const override = useApp((s) => (s.vehicle ? s.priceOverrides[s.vehicle.pricedFuel] : undefined));
  const [nonce, setNonce] = useState(0);

  const key = fuel ? `${fuel}|${chargingMode}|${override ?? ''}|${nonce}` : null;
  const res = useAsyncResource(key, (signal) =>
    // A manual reload (nonce > 0) bypasses the fresh cache.
    resolvePrice({ fuel: fuel!, chargingMode, override, signal, forceRefresh: nonce > 0 }),
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (res.status === 'ok') return { status: 'ready', resolved: res.data, stale: isPriceStale(res.data.price), reload };
  if (res.status === 'error') return { status: 'error', error: res.error, reload };
  return { status: 'loading', reload };
}
