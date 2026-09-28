/**
 * Tolerant local matching: small typos ("Utreht"), word order ("hogeschool zuyd"),
 * accents and punctuation ("'s-Hertogenbosch" ~ "shertogenbosch") don't matter.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`-]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const tokens = (s: string) => normalize(s).split(' ').filter(Boolean);

/** Damerau–Levenshtein distance with an early cut-off (returns max+1 when exceeded). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How well one query word matches one candidate word (0 = no match). */
function wordScore(q: string, w: string): number {
  if (w === q) return 4;
  if (w.startsWith(q)) return q.length >= 2 ? 3 : 1;
  if (q.length >= 4) {
    const allowed = q.length >= 7 ? 2 : 1;
    // Compare against the same-length prefix too, so a typo while still typing matches.
    if (editDistance(q, w, allowed) <= allowed || editDistance(q, w.slice(0, q.length), allowed) <= allowed) return 2;
  }
  if (q.length >= 3 && w.includes(q)) return 1;
  return 0;
}

/**
 * Score a candidate text for a query; every query word must match some candidate word,
 * in any order. Returns 0 for no match; higher is better.
 */
export function fuzzyScore(query: string, text: string): number {
  const qs = tokens(query);
  const ws = tokens(text);
  if (!qs.length || !ws.length) return 0;
  let total = 0;
  for (const q of qs) {
    let best = 0;
    for (const w of ws) best = Math.max(best, wordScore(q, w));
    if (!best) return 0;
    total += best;
  }
  // Prefer candidates whose words are mostly covered by the query ("Utrecht Centraal" over "Utrecht Centraal Station Parking").
  return total + qs.length / ws.length;
}

/** Add "~" (fuzzy) to longer words for Solr-based search (PDOK): "Amstrdam" → "Amstrdam~". */
export function toSolrFuzzy(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^[a-zà-ÿ'-]{4,}$/i.test(w) ? `${w}~` : w))
    .join(' ');
}
