/**
 * Published tariff tables (data, versioned, with sources). Update yearly (tariffs change 1 January).
 */
import nsFares from '../../data/ns-fares-2026.json';
import { nsTariffUnits } from './tariffUnits';

export interface NsFareTable {
  version: string;
  validFrom: string;
  validUntil: string;
  sourceUrl: string;
  /** [tariefeenheden, full, 20% off, 40% off] in cents. */
  rows: [number, number, number, number][];
}

export interface BtmTariff {
  /** Matches the operator/agency name (case-insensitive substring). Empty = default. */
  operatorMatch: string[];
  label: string;
  baseCents: number;
  /** Euro-cents per kilometre, may be fractional (e.g. 21.7). */
  centsPerKm: number;
  sourceUrl: string;
  /** false = regional rate not published/verified; we use the indexed national example. */
  verified: boolean;
}

export interface FareData {
  ns: NsFareTable;
  btm: BtmTariff[];
  /** Check-in within this many minutes after the previous BTM check-out → no new base fare. */
  btmTransferWindowMin: number;
  /** Official NS tariff units between two points (nearest stations), when known. */
  nsUnits?: (from: { lat: number; lon: number }, to: { lat: number; lon: number }) => number | undefined;
}

export const BTM_TARIFFS_2026: BtmTariff[] = [
  {
    operatorMatch: ['GVB'],
    label: 'GVB Amsterdam',
    baseCents: 116,
    centsPerKm: 21.7,
    sourceUrl: 'https://gvb.nl/nl/tarieven',
    verified: true,
  },
  {
    operatorMatch: ['U-OV', 'Qbuzz Utrecht', 'Keolis Utrecht', 'Transdev Utrecht'],
    label: 'U-OV Utrecht',
    baseCents: 116,
    centsPerKm: 20.1,
    sourceUrl: 'https://www.u-ov.nl/tarieven',
    verified: true,
  },
  {
    operatorMatch: [],
    label: 'Regionaal bus-/tramtarief (landelijk geïndexeerd voorbeeld)',
    baseCents: 116,
    centsPerKm: 20.6,
    sourceUrl: 'https://zoek.officielebekendmakingen.nl/prb-2025-20501.pdf',
    verified: false,
  },
];

export const FARE_DATA_2026: FareData = {
  ns: nsFares as unknown as NsFareTable,
  btm: BTM_TARIFFS_2026,
  btmTransferWindowMin: 35,
  nsUnits: nsTariffUnits,
};

/** NS price row for a number of tariff units (0–200; NS caps at 200). */
export function nsRow(table: NsFareTable, units: number): [number, number, number, number] {
  const te = Math.max(0, Math.min(200, Math.round(units)));
  return table.rows.find((r) => r[0] === te) ?? table.rows[table.rows.length - 1];
}

export function btmTariffFor(data: FareData, operator: string | undefined): BtmTariff {
  const op = (operator ?? '').toLowerCase();
  return (
    data.btm.find((t) => t.operatorMatch.some((m) => op.includes(m.toLowerCase()))) ??
    data.btm.find((t) => t.operatorMatch.length === 0)!
  );
}
