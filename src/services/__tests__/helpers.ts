/** Builds a fake fetch that answers each call with the next queued response. */
export function fakeFetch(...responses: (object | { status: number; body?: unknown; headers?: Record<string, string> } | Error)[]) {
  const calls: string[] = [];
  const queue = [...responses];
  const fn = jest.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${String(url)}`);
    if (next instanceof Error) throw next;
    const isSpec = 'status' in next && typeof (next as { status: unknown }).status === 'number';
    const status = isSpec ? (next as { status: number }).status : 200;
    const body = isSpec ? (next as { body?: unknown }).body : next;
    const headers = new Map(Object.entries(isSpec ? ((next as { headers?: Record<string, string> }).headers ?? {}) : {}));
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers.get(k) ?? null },
      json: async () => body,
    } as unknown as Response;
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

export const noSleep = () => Promise.resolve();
