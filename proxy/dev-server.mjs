// Local NS proxy for development — same code as the Cloudflare Worker, no account needed.
// Usage:  put NS_API_KEY=... in .env.proxy (git-ignored), then `npm run proxy`
//         and set EXPO_PUBLIC_API_BASE_URL=http://localhost:8787 in .env
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import worker from './ns-worker.mjs';

function loadEnv(file) {
  try {
    for (const line of readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // file is optional
  }
}
loadEnv('.env.proxy');

const env = { NS_API_KEY: process.env.NS_API_KEY };
if (!env.NS_API_KEY) console.warn('NS_API_KEY ontbreekt: zet hem in .env.proxy (zie README).');

const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const response = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method }), env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`NS-proxy draait op http://localhost:${port}`));
