// Generates src/data/models.json: per make, the model names registered in NL since 2005 (≥30 cars).
// Bundled so the first model search is instant; the app still refreshes per make from RDW (30-day cache).
// Re-run: `npm run data:models` (takes a few minutes; RDW aggregation queries are slow).
import { readFileSync, writeFileSync } from 'node:fs';

const { makes } = JSON.parse(readFileSync(new URL('../src/data/makes.json', import.meta.url)));
const out = {};
const q = (s) => `'${s.replace(/'/g, "''")}'`;

async function load(make) {
  const url =
    'https://opendata.rdw.nl/resource/m9d7-ebf2.json?' +
    new URLSearchParams({
      $select: 'upper(handelsbenaming) as model, count(*) as n',
      $where: `voertuigsoort='Personenauto' AND merk=${q(make)} AND datum_eerste_toelating > '20050101'`,
      $group: 'model',
      $having: 'n >= 30',
      $order: 'n DESC',
      $limit: '400',
    });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      return rows.filter((r) => r.model).map((r) => [r.model, Number(r.n)]);
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

const queue = makes.map((m) => m.rdw);
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const make = queue.shift();
      try {
        const rows = await load(make);
        if (rows.length) out[make] = rows;
      } catch (e) {
        console.warn(`skip ${make}: ${e.message}`);
      }
    }
  }),
);

writeFileSync(
  new URL('../src/data/models.json', import.meta.url),
  JSON.stringify({ source: 'RDW Open Data m9d7-ebf2', generatedAt: new Date().toISOString(), models: out }) + '\n',
);
console.log(`Wrote models for ${Object.keys(out).length} makes`);
