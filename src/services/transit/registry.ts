/**
 * Chooses the public transport provider. The UI only talks to `PublicTransportProvider`,
 * so 9292 / NS / Transitous can be swapped without touching screens.
 *
 * Order: 9292 (needs licence) → NS via our proxy (needs NS key on a server) → Transitous (free).
 * Unavailable providers report a status; they never return made-up data.
 */
import { AppError, isAbort } from '../http';
import { mockTransit } from './mock';
import { ninetwoninetwo } from './ninetwoninetwo';
import { nsProxy } from './ns';
import { transitous } from './transitous';
import type { PublicTransportProvider } from './types';

export function allTransitProviders(): PublicTransportProvider[] {
  const list: PublicTransportProvider[] = [ninetwoninetwo, nsProxy, transitous];
  // Development only, behind an explicit flag — never in a production build.
  if (process.env.EXPO_PUBLIC_TRANSIT_MOCK === '1' && typeof __DEV__ !== 'undefined' && __DEV__) list.unshift(mockTransit);
  return list;
}

export function availableTransitProviders(): PublicTransportProvider[] {
  return allTransitProviders().filter((p) => p.availability().status === 'available');
}

/** Run `call` on each available provider until one succeeds; offline/abort stop the chain. */
export async function withTransitProvider<T>(
  call: (p: PublicTransportProvider) => Promise<T>,
  providers = availableTransitProviders(),
): Promise<{ provider: PublicTransportProvider; result: T }> {
  let lastError: unknown = new AppError('provider', 'transit: no provider available', 'transit');
  for (const provider of providers) {
    try {
      return { provider, result: await call(provider) };
    } catch (e) {
      if (isAbort(e)) throw e;
      if (e instanceof AppError && e.kind === 'offline') throw e;
      lastError = e;
    }
  }
  throw lastError;
}
