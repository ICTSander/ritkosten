/**
 * Device location — foreground only, requested just-in-time, never persisted.
 */
import * as Location from 'expo-location';

export type LocationResult =
  | { status: 'ok'; lat: number; lon: number }
  | { status: 'denied' }
  | { status: 'unavailable' };

export async function getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestAndGetPosition(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };
    return await getPosition();
  } catch {
    return { status: 'unavailable' };
  }
}

/** Assumes permission was granted. Uses a recent cached fix when available (fast). */
export async function getPosition(): Promise<LocationResult> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1000 });
    const pos =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 12_000)),
      ]));
    if (!pos) return { status: 'unavailable' };
    return { status: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude };
  } catch {
    return { status: 'unavailable' };
  }
}
