/**
 * Official NS tariff units ("tariefeenheden") between stations — open data (CC0) from
 * Rijden de Treinen, derived from NS tariff data. Stations are matched by coordinates
 * (the nearest station within 1 km of where the train leg starts/ends), so it works with
 * any journey planner regardless of how it spells station names.
 */
import data from '../../data/ns-tariff-units.json';

interface StationRow {
  c: string;
  n: string[];
  lat: number;
  lon: number;
}

const stations = (data as { stations: StationRow[] }).stations;
const tri = (data as { tri: string }).tri;
const N = stations.length;

export const TARIFF_UNITS_SOURCE = (data as { source: string }).source;

function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const kx = 111_320 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const dx = (aLon - bLon) * kx;
  const dy = (aLat - bLat) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Index of the nearest station within `maxM` metres, or -1. */
export function nearestStationIndex(lat: number, lon: number, maxM = 1000): number {
  let best = -1;
  let bestD = maxM;
  for (let i = 0; i < N; i++) {
    const s = stations[i];
    if (!s.lat) continue;
    const d = distanceM(lat, lon, s.lat, s.lon);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function stationCode(index: number): string | undefined {
  return stations[index]?.c;
}

/** Tariff units between two station indexes (symmetric), or undefined when unknown. */
export function unitsBetween(i: number, j: number): number | undefined {
  if (i < 0 || j < 0) return undefined;
  if (i === j) return 0;
  const [a, b] = i < j ? [i, j] : [j, i];
  // Position of (a, b) in the row-major upper triangle without the diagonal.
  const pos = a * N - (a * (a + 1)) / 2 + (b - a - 1);
  const code = tri.slice(pos * 2, pos * 2 + 2);
  return code === 'zz' || code.length < 2 ? undefined : parseInt(code, 36);
}

/** Tariff units between two coordinates (train leg origin → destination). */
export function nsTariffUnits(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number | undefined {
  return unitsBetween(nearestStationIndex(from.lat, from.lon), nearestStationIndex(to.lat, to.lon));
}

/** NS station code (e.g. "HRL") of the station nearest to a point, within `maxM` metres. */
export function nearestStationCode(lat: number, lon: number, maxM = 800): string | undefined {
  return stationCode(nearestStationIndex(lat, lon, maxM));
}
