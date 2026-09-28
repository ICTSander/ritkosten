// Builds src/data/ns-tariff-units.json from open data (CC0) by Rijden de Treinen, derived from NS tariff data:
//   https://www.rijdendetreinen.nl/en/open-data/station-distances   (tariff units between stations)
//   https://www.rijdendetreinen.nl/en/open-data/stations            (station list with coordinates)
// Stored compactly: upper-triangle matrix, 2 base-36 chars per pair ("zz" = unknown). Re-run: `npm run data:tariff-units`.
import { writeFileSync } from 'node:fs';

const BASE = 'https://opendata.rijdendetreinen.nl/public';
const MATRIX = `${BASE}/tariff-distances/tariff-distances-2022-01-ns-ns-international.csv`;
const STATIONS = `${BASE}/stations/stations-2023-09-nl.csv`;

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const out = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

const [matrixCsv, stationsCsv] = await Promise.all([MATRIX, STATIONS].map((u) => fetch(u).then((r) => r.text())));
const m = parseCsv(matrixCsv);
const codes = m[0].slice(1);
const values = new Map(m.slice(1).map((row) => [row[0], row.slice(1)]));

const st = parseCsv(stationsCsv);
const header = st[0];
const idx = (k) => header.indexOf(k);
const byCode = new Map(
  st.slice(1).map((r) => [
    r[idx('code')],
    { n: [...new Set([r[idx('name_long')], r[idx('name_medium')], r[idx('name_short')]])], lat: Number(r[idx('geo_lat')]), lon: Number(r[idx('geo_lng')]) },
  ]),
);

const stations = codes.map((c) => ({ c, ...(byCode.get(c) ?? { n: [c], lat: 0, lon: 0 }) }));
let tri = '';
let asymmetric = 0;
for (let i = 0; i < codes.length; i++) {
  for (let j = i + 1; j < codes.length; j++) {
    const a = values.get(codes[i])[j];
    const b = values.get(codes[j])[i];
    if (a !== b) asymmetric++;
    const n = /^\d+$/.test(a) ? Number(a) : /^\d+$/.test(b) ? Number(b) : null;
    tri += n === null || n > 1294 ? 'zz' : n.toString(36).padStart(2, '0');
  }
}
writeFileSync(
  new URL('../src/data/ns-tariff-units.json', import.meta.url),
  JSON.stringify({
    source: 'Rijden de Treinen open data (CC0), NS tariefeenheden 2022-01; stations 2023-09',
    sourceUrl: 'https://www.rijdendetreinen.nl/en/open-data/station-distances',
    generatedAt: new Date().toISOString(),
    stations,
    tri,
  }) + '\n',
);
console.log(`stations ${codes.length}, without coords ${stations.filter((s) => !s.lat).length}, asymmetric pairs ${asymmetric}, bytes ${tri.length}`);
