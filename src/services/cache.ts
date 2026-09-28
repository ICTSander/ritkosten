/**
 * Small persistent cache (memory + AsyncStorage) with TTL.
 * Never throws: storage can be unavailable (private browsing, tests) and the app must still work.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Entry<T> {
  v: T;
  at: number;
}

const memory = new Map<string, Entry<unknown>>();
const PREFIX = 'cache:v1:';

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<{ value: T; ageMs: number } | null> {
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry) {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      if (raw) {
        entry = JSON.parse(raw) as Entry<T>;
        memory.set(key, entry);
      }
    } catch {
      return null;
    }
  }
  if (!entry || typeof entry.at !== 'number') return null;
  const ageMs = Date.now() - entry.at;
  return ageMs <= maxAgeMs ? { value: entry.v, ageMs } : null;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: Entry<T> = { v: value, at: Date.now() };
  memory.set(key, entry);
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // ignore — memory cache still works
  }
}

/** Return a cached value if fresh, otherwise load + store it. */
export async function cached<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key, maxAgeMs);
  if (hit) return hit.value;
  const value = await load();
  await cacheSet(key, value);
  return value;
}

export async function cacheClearAll(): Promise<void> {
  memory.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch {
    // ignore
  }
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
