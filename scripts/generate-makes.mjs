// Generates src/data/makes.json from RDW Open Data (passenger cars registered since 2005, ≥200 cars).
// Makes change rarely; bundling them makes the first search instant. Re-run: `npm run data:makes`.
import { writeFileSync } from 'node:fs';

const url =
  'https://opendata.rdw.nl/resource/m9d7-ebf2.json?' +
  new URLSearchParams({
    $select: 'merk,count(*) as n',
    $where: "voertuigsoort='Personenauto' AND datum_eerste_toelating > '20050101'",
    $group: 'merk',
    $having: 'n >= 200',
    $order: 'n DESC',
    $limit: '1000',
  });

const res = await fetch(url);
if (!res.ok) throw new Error(`RDW HTTP ${res.status}`);
const rows = await res.json();
const makes = rows.map((r) => ({ rdw: r.merk, count: Number(r.n) }));
writeFileSync(
  new URL('../src/data/makes.json', import.meta.url),
  JSON.stringify({ source: 'RDW Open Data m9d7-ebf2', generatedAt: new Date().toISOString(), makes }, null, 1) + '\n',
);
console.log(`Wrote ${makes.length} makes`);
