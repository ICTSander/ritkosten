import { searchLocal, withLocalFirst } from '../geocoding';
import { editDistance, fuzzyScore, toSolrFuzzy } from '../fuzzy';

describe('fuzzy matching', () => {
  it('computes edit distance incl. swapped letters', () => {
    expect(editDistance('utreht', 'utrecht')).toBe(1);
    expect(editDistance('amstrdam', 'amsterdam')).toBe(1);
    expect(editDistance('maastrihct', 'maastricht')).toBe(1); // transposition
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });

  it('finds typos, other word order, partial words and accents', () => {
    expect(fuzzyScore('Utreht Centraal', 'Utrecht Centraal')).toBeGreaterThan(0);
    expect(fuzzyScore('centraal amsterdam', 'Amsterdam Centraal')).toBeGreaterThan(0);
    expect(fuzzyScore('hogeschool zuyd', 'Zuyd Hogeschool')).toBeGreaterThan(0);
    expect(fuzzyScore('amsterdam cent', 'Amsterdam Centraal')).toBeGreaterThan(0);
    expect(fuzzyScore('shertogenbosch', "'s-Hertogenbosch")).toBeGreaterThan(0);
    expect(fuzzyScore('Amstrdam Centrl', 'Amsterdam Centraal')).toBeGreaterThan(0);
  });

  it('does not match unrelated names', () => {
    expect(fuzzyScore('Utrecht', 'Amsterdam Centraal')).toBe(0);
    expect(fuzzyScore('Zwolle', 'Zandvoort aan Zee')).toBe(0);
  });

  it('ranks exact matches above fuzzy ones', () => {
    expect(fuzzyScore('Utrecht Centraal', 'Utrecht Centraal')).toBeGreaterThan(fuzzyScore('Utreht Centraal', 'Utrecht Centraal'));
  });

  it('builds a fuzzy PDOK query but keeps numbers exact', () => {
    expect(toSolrFuzzy('Damrak 1 Amsterdm')).toBe('Damrak~ 1 Amsterdm~');
    expect(toSolrFuzzy('Ede')).toBe('Ede');
  });
});


describe('instant local search', () => {
  it('finds stations despite typos and word order', () => {
    expect(searchLocal('Utreht Centraal')[0]?.label).toBe('Utrecht Centraal');
    expect(searchLocal('centraal amsterdam')[0]?.label).toBe('Amsterdam Centraal');
    expect(searchLocal('maastrict')[0]?.label).toMatch(/^Maastricht/);
  });

  it('puts the user’s own recent places first', () => {
    const recent = [{ id: 'r1', label: 'Zuyd Hogeschool', detail: 'Universiteit · Heerlen', lat: 50.88, lon: 5.96, kind: 'poi', source: 'photon' } as const];
    expect(searchLocal('hogeschool zuyd', [...recent])[0]?.label).toBe('Zuyd Hogeschool');
  });

  it('needs at least 2 characters', () => {
    expect(searchLocal('a')).toEqual([]);
  });
});

describe('local-first merge', () => {
  it('keeps local results on top and drops remote duplicates', () => {
    const local = searchLocal('amsterdam centraal');
    const remote = [
      { id: 'p1', label: 'Amsterdam Centraal', lat: local[0].lat + 0.001, lon: local[0].lon, kind: 'station', source: 'photon' } as const,
      { id: 'p2', label: 'Rijksmuseum', lat: 52.36, lon: 4.885, kind: 'poi', source: 'photon' } as const,
    ];
    const merged = withLocalFirst(local, [...remote]);
    expect(merged[0].source).toBe('local');
    expect(merged.filter((p) => p.label === 'Amsterdam Centraal')).toHaveLength(1);
    expect(merged.some((p) => p.label === 'Rijksmuseum')).toBe(true);
  });
});
