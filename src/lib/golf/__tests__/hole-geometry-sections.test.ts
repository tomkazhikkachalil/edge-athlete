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
