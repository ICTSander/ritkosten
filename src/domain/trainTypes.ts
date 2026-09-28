/** "Over deze trein": sourced facts per rolling-stock type (see src/data/train-types.json). */
import data from '../data/train-types.json';

export interface TrainTypeInfo {
  code: string;
  matchCodes: string[];
  name: string;
  builder: string | null;
  inServiceSince: string | null;
  operators: string[];
  doubleDeck: boolean | null;
  maxSpeedKmh: number | null;
  description: string;
  tag: 'Modern' | 'Klassiek' | null;
  sourceUrls: string[];
}

const TYPES = (data as { types: TrainTypeInfo[] }).types;
// Longest prefix first: "FLIRT2ARR" must win over "FLIRT", "ICMM" over "ICM".
const PREFIXES = TYPES.flatMap((t) => t.matchCodes.map((code) => ({ code, t }))).sort((a, b) => b.code.length - a.code.length);

/** Match an NS API type string like "VIRMm1 IV", "Flirt 2 ARR", "ICM". */
export function trainTypeInfo(apiType: string | undefined): TrainTypeInfo | undefined {
  if (!apiType) return undefined;
  const key = apiType.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PREFIXES.find((p) => key.startsWith(p.code))?.t;
}
