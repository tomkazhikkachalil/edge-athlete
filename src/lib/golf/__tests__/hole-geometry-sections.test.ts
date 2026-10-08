import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseHoleWaysLenient,
  clusterHoleLoops,
  assignClustersToSections,
  resolveSectionGeometries,
  composeHoleGeometry,
  type HoleGeometry,
} from '../hole-geometry';

// Synthetic club: two nines with duplicate refs 1–9 (the Ottawa Hunt shape).
// Loop holes run south→north; hole i's green sits ~55 m from hole i+1's tee,
// while the loops sit ~1.5 km apart in longitude — unambiguous chaining.
interface TestElement {
  type: string;
  tags: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

function loopWay(lng: number, i: number, extraTags: Record<string, string> = {}): TestElement {
  const lat = 45.3 + i * 0.001;
  return {
    type: 'way',
    tags: { golf: 'hole', ref: String(i + 1), par: '4', ...extraTags },
    geometry: [
      { lat, lon: lng },
      { lat: lat + 0.0005, lon: lng },
    ],
  };
}

const LOOP_A_LNG = -75.7;
const LOOP_B_LNG = -75.72;

function twoLoopPayload(opts: { bLng?: number; nameB?: string } = {}): { elements: TestElement[] } {
  const bLng = opts.bLng ?? LOOP_B_LNG;
  return {
    elements: [
      ...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)),
      ...Array.from({ length: 9 }, (_, i) =>
        loopWay(bLng, i, opts.nameB ? { name: opts.nameB } : {})
      ),
    ],
  };
}

function boundary(name: string, lngCenter: number): TestElement {
  const w = 0.001;
  return {
    type: 'way',
    tags: { leisure: 'golf_course', name },
    geometry: [
      { lat: 45.299, lon: lngCenter - w },
      { lat: 45.311, lon: lngCenter - w },
      { lat: 45.311, lon: lngCenter + w },
      { lat: 45.299, lon: lngCenter + w },
      { lat: 45.299, lon: lngCenter - w },
    ],
  };
}

describe('parseHoleWaysLenient', () => {
  it('accepts duplicate refs (unlike the strict parse)', () => {
    const ways = parseHoleWaysLenient(twoLoopPayload());
    expect(ways).toHaveLength(18);
  });

  it('still rejects unlabeled ways', () => {
    const payload = twoLoopPayload();
    delete (payload.elements[0].tags as Record<string, string>).ref;
    expect(parseHoleWaysLenient(payload)).toBeNull();
  });
});

describe('clusterHoleLoops', () => {
  const ways = () => parseHoleWaysLenient(twoLoopPayload())!;

  it('splits duplicate-ref ways into two coherent nine-hole loops', () => {
    const clusters = clusterHoleLoops(ways());
    expect(clusters).toHaveLength(2);
    for (const c of clusters!) {
      expect(c.map(h => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      // one loop = one longitude
      expect(new Set(c.map(h => h.line[0][1])).size).toBe(1);
    }
  });

  it('nulls on uneven ref counts', () => {
    const w = ways();
    expect(clusterHoleLoops(w.slice(0, 17))).toBeNull();
  });

  it('nulls when the loops sit too close to separate (near-tie)', () => {
    // ~23 m apart: chosen ~55 m vs rival ~60 m — inside the dominance band.
    const w = parseHoleWaysLenient(twoLoopPayload({ bLng: LOOP_A_LNG - 0.0003 }))!;
    expect(clusterHoleLoops(w)).toBeNull();
  });

  it('nulls when a link exceeds walking distance', () => {
    const payload = twoLoopPayload();
    // Displace BOTH ref-6 ways ~550 m north: whatever the assignment, the
    // green(5)→tee(6) link breaks the 300 m ceiling.
    for (const el of payload.elements) {
      if (el.tags?.ref === '6') {
        el.geometry = el.geometry.map(g => ({ ...g, lat: g.lat + 0.005 }));
      }
    }
    expect(clusterHoleLoops(parseHoleWaysLenient(payload)!)).toBeNull();
  });

  it('nulls on a single loop (no duplicates to split)', () => {
    const single = parseHoleWaysLenient({
      elements: Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)),
    })!;
    expect(clusterHoleLoops(single)).toBeNull();
  });
});

describe('assignClustersToSections', () => {
  const sections = [
    { id: 'sec-north', name: 'Synthetic Club (North Nine)', section_name: 'North Nine' },
    { id: 'sec-south', name: 'Synthetic Club (South Nine)', section_name: 'South Nine' },
  ];

  it('labels loops from section-named sub-boundaries', () => {
    const payload = twoLoopPayload();
    payload.elements.push(
      boundary('Synthetic North Nine', LOOP_A_LNG),
      boundary('Synthetic South Nine', LOOP_B_LNG)
    );
    const clusters = clusterHoleLoops(parseHoleWaysLenient(payload)!)!;
    const assigned = assignClustersToSections(clusters, sections, payload);
    expect(assigned).not.toBeNull();
    expect([...assigned!.keys()].sort()).toEqual(['sec-north', 'sec-south']);
    const north = assigned!.get('sec-north')!;
    expect(north.holes).toHaveLength(9);
    expect(north.holes[0].line[0][1]).toBe(LOOP_A_LNG);
  });

  it('labels loops from hole-way name tags', () => {
    const payload = twoLoopPayload({ nameB: 'South Nine hole' });
    const clusters = clusterHoleLoops(parseHoleWaysLenient(payload)!)!;
    const assigned = assignClustersToSections(clusters, sections, payload);
    // Only loop B carries evidence — loop A has none, so the WHOLE answer
    // must be null (partial labeling would leave a guessable remainder).
    expect(assigned).toBeNull();
  });

  it('returns null with no evidence at all (the honest Ottawa Hunt answer)', () => {
    const payload = twoLoopPayload();
    const clusters = clusterHoleLoops(parseHoleWaysLenient(payload)!)!;
    expect(assignClustersToSections(clusters, sections, payload)).toBeNull();
  });

  it('returns null when a club-wide boundary would match every section', () => {
    const payload = twoLoopPayload();
    // A boundary named for the CLUB shares no section discriminator tokens,
    // so it is not evidence — and must not become an accidental label.
    payload.elements.push(boundary('Synthetic Club', LOOP_A_LNG));
    const clusters = clusterHoleLoops(parseHoleWaysLenient(payload)!)!;
    expect(assignClustersToSections(clusters, sections, payload)).toBeNull();
  });
});

describe('resolveSectionGeometries', () => {
  it('end-to-end: lenient parse → cluster → label', () => {
    const payload = twoLoopPayload();
    payload.elements.push(
      boundary('Synthetic North Nine', LOOP_A_LNG),
      boundary('Synthetic South Nine', LOOP_B_LNG)
    );
    const assigned = resolveSectionGeometries(payload, [
      { id: 'a', name: 'Synthetic Club (North Nine)', section_name: 'North Nine' },
      { id: 'b', name: 'Synthetic Club (South Nine)', section_name: 'South Nine' },
    ]);
    expect(assigned?.size).toBe(2);
  });

  it('null without sections or on unparseable payloads', () => {
    expect(resolveSectionGeometries(twoLoopPayload(), [])).toBeNull();
    expect(resolveSectionGeometries({ nope: true }, [{ id: 'a', name: 'X', section_name: 'Y' }])).toBeNull();
  });
});

describe('real Ottawa Hunt fixture (captured Overpass payload, Aug 2026)', () => {
  // The club that motivated all of this: 27 holes, two nines mapped in OSM
  // as duplicate refs 1–9 inside one club boundary, no section names.
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/ottawa-hunt-overpass.json', import.meta.url), 'utf8')
  );

  it('cluster-splits the real duplicate-ref payload into two clean nines', () => {
    const ways = parseHoleWaysLenient(fixture);
    expect(ways).toHaveLength(18);
    const clusters = clusterHoleLoops(ways!);
    expect(clusters).toHaveLength(2);
    for (const c of clusters!) {
      expect(c.map(h => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });

  it('refuses to LABEL the real nines (no section evidence in OSM) — honest null', () => {
    const clusters = clusterHoleLoops(parseHoleWaysLenient(fixture)!)!;
    const assigned = assignClustersToSections(
      clusters,
      [
        { id: 'n', name: 'Ottawa Hunt and Golf Club (North Nine)', section_name: 'North Nine' },
        { id: 's', name: 'Ottawa Hunt and Golf Club (South Nine)', section_name: 'South Nine' },
      ],
      fixture
    );
    expect(assigned).toBeNull();
  });
});

describe('composeHoleGeometry', () => {
  const nineGeo = (lng: number): HoleGeometry => ({
    holes: Array.from({ length: 9 }, (_, i) => ({
      hole: i + 1,
      par: 4,
      line: [
        [45.3 + i * 0.001, lng],
        [45.3005 + i * 0.001, lng],
      ] as [number, number][],
    })),
    source: 'osm',
  });

  it('merges two nines into holes 1–18', () => {
    const combo = composeHoleGeometry(nineGeo(LOOP_A_LNG), nineGeo(LOOP_B_LNG));
    expect(combo?.holes.map(h => h.hole)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1)
    );
    expect(combo!.holes[9].line[0][1]).toBe(LOOP_B_LNG); // hole 10 = back's 1
  });

  it('nulls unless both sides are exactly a 1–9 nine', () => {
    expect(composeHoleGeometry(nineGeo(LOOP_A_LNG), null)).toBeNull();
    const eighteen: HoleGeometry = {
      holes: Array.from({ length: 18 }, (_, i) => ({
        hole: i + 1,
        par: 4,
        line: [[45.3, -75.7], [45.31, -75.7]] as [number, number][],
      })),
      source: 'osm',
    };
    expect(composeHoleGeometry(eighteen, nineGeo(LOOP_B_LNG))).toBeNull();
  });
});

describe('the section split carries greens (PR G2)', () => {
  it('each sibling picks its own greens out of the one payload', async () => {
    const { withGreens, resolveSectionGeometries: resolve } = await import('../hole-geometry');
    const sections = [
      { id: 'sec-north', name: 'Synthetic Club (North Nine)', section_name: 'North Nine' },
      { id: 'sec-south', name: 'Synthetic Club (South Nine)', section_name: 'South Nine' },
    ];
    const payload = twoLoopPayload();
    payload.elements.push(boundary('Synthetic North Nine', LOOP_A_LNG), boundary('Synthetic South Nine', LOOP_B_LNG));
    // A 10 m square green at loop A's hole 1 end only.
    const end = { lat: 45.3 + 0.0005, lon: LOOP_A_LNG };
    const d = 0.0001;
    payload.elements.push({
      type: 'way',
      tags: { golf: 'green' },
      geometry: [
        { lat: end.lat - d, lon: end.lon - d }, { lat: end.lat - d, lon: end.lon + d },
        { lat: end.lat + d, lon: end.lon + d }, { lat: end.lat + d, lon: end.lon - d },
        { lat: end.lat - d, lon: end.lon - d },
      ],
    });
    const assigned = resolve(payload, sections)!;
    const north = withGreens(assigned.get('sec-north')!, payload);
    const south = withGreens(assigned.get('sec-south')!, payload);
    expect(north.greens!.map(g => g.hole)).toEqual([1]);
    expect(south.greens).toEqual([]);
  });
});

// ── Mixed multiplicity + unlabelled loops (map sweep PR 4) ──────────────────
import { resolveLoopGeometry, scopeHoleWays, scopedPayload, withGreens, type OverpassElement } from '../hole-geometry';
import emeraldLinks from './fixtures/overpass-emerald-links.json';
import royalOttawaCluster from './fixtures/overpass-royal-ottawa-cluster.json';

describe('clusterHoleLoops — the multiplicity table', () => {
  /** Loop B continues past ref 9 as an 18; loop A closes at 9 — the 18+9 club. */
  const eighteenPlusNine = () => ({
    elements: [
      ...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)),
      ...Array.from({ length: 18 }, (_, i) => loopWay(LOOP_B_LNG, i)),
    ],
  });
  it('an 18 and a nine on one club cluster as [9, 18]', () => {
    const ways = parseHoleWaysLenient(eighteenPlusNine())!;
    expect(ways).toHaveLength(27);
    const loops = clusterHoleLoops(ways)!;
    expect(loops).not.toBeNull();
    expect(loops.map(l => l.length).sort((a, b) => a - b)).toEqual([9, 18]);
    expect(loops.find(l => l.length === 18)!.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
  it('a multiplicity that INCREASES, a gap in the refs, or a loop that closes off a nine → null', () => {
    // 1–9 ×2 then 10–18 ×3: two extra 10–18 copies — more back nines than front nines.
    const increasing = {
      elements: [
        ...eighteenPlusNine().elements,
        ...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_B_LNG + 0.02, i + 9)),
        ...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_B_LNG + 0.04, i + 9)),
      ],
    };
    expect(clusterHoleLoops(parseHoleWaysLenient(increasing)!)).toBeNull();
    // Loop B stops at 13: a loop of 13 is not a course.
    const thirteen = { elements: [...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)), ...Array.from({ length: 13 }, (_, i) => loopWay(LOOP_B_LNG, i))] };
    expect(clusterHoleLoops(parseHoleWaysLenient(thirteen)!)).toBeNull();
    // Refs 1–9 ×2 with ref 5 missing from one loop: a gap → null.
    const gap = { elements: twoLoopPayload().elements.filter(e => !(e.tags.ref === '5' && e.geometry[0].lon === LOOP_B_LNG)) };
    expect(clusterHoleLoops(parseHoleWaysLenient(gap)!)).toBeNull();
    // Refs starting at 2 → null.
    const from2 = { elements: twoLoopPayload().elements.filter(e => e.tags.ref !== '1') };
    expect(clusterHoleLoops(parseHoleWaysLenient(from2)!)).toBeNull();
  });
});

describe('resolveLoopGeometry — pickable sections, and the one promotion', () => {
  const courseOf = (fx: unknown) => (fx as { _course: { name: string; lat: number; lng: number } })._course;
  const elementsOf = (fx: unknown) => (fx as { elements: OverpassElement[] }).elements;
  it('Emerald Links: three clean nines nothing labels → sections A, B, C with their own greens', () => {
    const c = courseOf(emeraldLinks);
    const els = elementsOf(emeraldLinks);
    const scoped = scopedPayload(els, scopeHoleWays(els, c.name, [c.lat, c.lng]));
    const g = resolveLoopGeometry(scoped, 27)!;
    expect(g).not.toBeNull();
    expect(g.holes).toEqual([]);
    expect(g.sections!.map(s => s.label).sort()).toEqual(['A', 'B', 'C']);
    expect(g.sections!.every(s => s.holes.length === 9 && s.holes.map(h => h.hole).join() === '1,2,3,4,5,6,7,8,9')).toBe(true);
    const wg = withGreens(g, scoped);
    expect(wg.sections!.map(s => s.greens!.length)).toEqual([9, 9, 9]);
    expect(wg.greens).toEqual([]);
  });
  it('the labels are deterministic: the same payload twice, and a shuffled element order, give the same letters', () => {
    const c = courseOf(emeraldLinks);
    const els = elementsOf(emeraldLinks);
    const a = resolveLoopGeometry(scopedPayload(els, scopeHoleWays(els, c.name, [c.lat, c.lng])), 27)!;
    const shuffled = [...els].reverse();
    const b = resolveLoopGeometry(scopedPayload(shuffled, scopeHoleWays(shuffled, c.name, [c.lat, c.lng])), 27)!;
    const key = (g: typeof a) => g.sections!.map(s => `${s.label}:${s.holes[0].line[0].join(',')}`).sort().join('|');
    expect(key(a)).toBe(key(b));
  });
  it('the catalog says 18 and exactly one loop is an 18 → that loop IS the course; otherwise sections', () => {
    const payload = { elements: [...Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)), ...Array.from({ length: 18 }, (_, i) => loopWay(LOOP_B_LNG, i))] };
    const promoted = resolveLoopGeometry(payload, 18)!;
    expect(promoted.holes).toHaveLength(18);
    expect('sections' in promoted).toBe(false);
    const club = resolveLoopGeometry(payload, 27)!;
    expect(club.holes).toEqual([]);
    expect(club.sections!.map(s => s.holes.length).sort((a, b) => a - b)).toEqual([9, 18]);
    expect(resolveLoopGeometry(payload, null)!.sections).toHaveLength(2);
  });
  it('Royal Ottawa: its 18 and West Nine share a clubhouse hub — a near-tie at the 5th and 10th tees, an honest null', () => {
    const c = courseOf(royalOttawaCluster);
    const els = elementsOf(royalOttawaCluster);
    const scoped = scopedPayload(els, scopeHoleWays(els, c.name, [c.lat, c.lng]));
    expect(parseHoleWaysLenient(scoped)).toHaveLength(27);
    expect(resolveLoopGeometry(scoped, 18)).toBeNull();
  });
  it('a single loop (no duplicates) is the strict parse’s job → null here', () => {
    expect(resolveLoopGeometry({ elements: Array.from({ length: 9 }, (_, i) => loopWay(LOOP_A_LNG, i)) }, 9)).toBeNull();
  });
});
