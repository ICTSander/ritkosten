/**
 * Hand-off to an external navigation app. We plan and compare; Google Maps navigates.
 *
 * Uses Google's universal "Maps URLs" (https://developers.google.com/maps/documentation/urls/get-started):
 * opens the Google Maps app when installed (Android app link / iOS universal link), else the browser.
 * Omitting `origin` makes Maps start from the device location — so we never need to send our
 * user's position anywhere.
 */
import * as Linking from 'expo-linking';

export type NavigationMode = 'driving' | 'transit' | 'walking' | 'bicycling';

export interface NavTarget {
  lat: number;
  lon: number;
  label?: string;
}

export interface MapsNavigationProvider {
  id: string;
  buildDirectionsUrl(opts: { destination: NavTarget; origin?: NavTarget; mode: NavigationMode }): string;
}

export function buildGoogleMapsDirectionsUrl({
  destination,
  origin,
  mode = 'driving',
  navigate = mode === 'driving',
}: {
  destination: NavTarget;
  origin?: NavTarget;
  mode?: NavigationMode;
  navigate?: boolean;
}): string {
  const p = new URLSearchParams({
    api: '1',
    destination: `${destination.lat.toFixed(6)},${destination.lon.toFixed(6)}`,
    travelmode: mode,
  });
  if (origin) p.set('origin', `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)}`);
  // "navigate" starts turn-by-turn when the origin is the device; only meaningful for driving.
  if (navigate && mode === 'driving') p.set('dir_action', 'navigate');
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export const googleMaps: MapsNavigationProvider = {
  id: 'google-maps',
  buildDirectionsUrl: ({ destination, origin, mode }) => buildGoogleMapsDirectionsUrl({ destination, origin, mode }),
};

export async function openDirections(
  opts: { destination: NavTarget; origin?: NavTarget; mode: NavigationMode },
  provider: MapsNavigationProvider = googleMaps,
): Promise<boolean> {
  try {
    await Linking.openURL(provider.buildDirectionsUrl(opts));
    return true;
  } catch {
    return false;
  }
}
