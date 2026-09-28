/**
 * Tiny fetch wrapper: timeout, retry with backoff on 429/5xx/network errors,
 * typed errors the UI can map to states. No retries for other 4xx.
 */

export type AppErrorKind = 'offline' | 'timeout' | 'rate-limit' | 'not-found' | 'provider';

export class AppError extends Error {
  constructor(
    public readonly kind: AppErrorKind,
    message: string,
    public readonly provider?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export interface FetchJsonOptions {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Injected for tests. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  return undefined;
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const {
    provider,
    timeoutMs = 8000,
    retries = 2,
    signal,
    headers,
    fetchFn = fetch,
    sleep = defaultSleep,
  } = opts;

  let lastError: AppError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new AbortedError();

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const res = await fetchFn(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new AppError('provider', `${provider}: invalid response`, provider);
        }
      }

      if (res.status === 404) throw new AppError('not-found', `${provider}: not found`, provider);
      if (res.status === 429) {
        lastError = new AppError(
          'rate-limit',
          `${provider}: rate limited`,
          provider,
          parseRetryAfter(res.headers.get('Retry-After')),
        );
      } else if (res.status >= 500) {
        lastError = new AppError('provider', `${provider}: HTTP ${res.status}`, provider);
      } else {
        // Other 4xx: our request is wrong, retrying will not help.
        throw new AppError('provider', `${provider}: HTTP ${res.status}`, provider);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (signal?.aborted) throw new AbortedError();
      lastError = timedOut
        ? new AppError('timeout', `${provider}: timed out`, provider)
        : new AppError('offline', `${provider}: network request failed`, provider);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (attempt < retries) {
      const backoff = lastError?.retryAfterMs ?? 400 * 2 ** attempt + Math.random() * 200;
      await sleep(backoff);
    }
  }

  throw lastError ?? new AppError('provider', `${provider}: unknown error`, provider);
}

/** Thrown when the caller aborted (e.g. user kept typing). Callers should ignore it. */
export class AbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}
