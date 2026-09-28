import { AppError, fetchJson } from '../http';
import { fakeFetch, noSleep } from './helpers';

describe('fetchJson', () => {
  it('returns JSON on success', async () => {
    const { fetchFn } = fakeFetch({ ok: 1 });
    await expect(fetchJson('u', { provider: 'p', fetchFn })).resolves.toEqual({ ok: 1 });
  });

  it('retries on 503 then succeeds', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 503 }, { status: 503 }, { done: true });
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 2, sleep: noSleep })).resolves.toEqual({ done: true });
    expect(calls).toHaveLength(3);
  });

  it('honours Retry-After on 429', async () => {
    const sleep = jest.fn(noSleep);
    const { fetchFn } = fakeFetch({ status: 429, headers: { 'Retry-After': '2' } }, { ok: 1 });
    await fetchJson('u', { provider: 'p', fetchFn, retries: 1, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('reports rate-limit after exhausting retries', async () => {
    const { fetchFn } = fakeFetch({ status: 429 }, { status: 429 });
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 1, sleep: noSleep })).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('never retries other 4xx', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 400 });
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 3, sleep: noSleep })).rejects.toBeInstanceOf(AppError);
    expect(calls).toHaveLength(1);
  });

  it('maps 404 to not-found without retry', async () => {
    const { fetchFn, calls } = fakeFetch({ status: 404 });
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 3 })).rejects.toMatchObject({ kind: 'not-found' });
    expect(calls).toHaveLength(1);
  });

  it('maps network failures to offline', async () => {
    const { fetchFn } = fakeFetch(new TypeError('Network request failed'), new TypeError('Network request failed'));
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 1, sleep: noSleep })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('times out slow requests', async () => {
    const fetchFn = ((_: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(fetchJson('u', { provider: 'p', fetchFn, retries: 0, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('propagates caller aborts as AbortError', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchFn } = fakeFetch({ ok: 1 });
    await expect(fetchJson('u', { provider: 'p', fetchFn, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
