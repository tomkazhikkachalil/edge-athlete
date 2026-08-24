import { describe, expect, it } from 'vitest';
import {
  courseNameScore,
  greenDistanceYards,
  polylineYards,
  targetDistances,
  yardsBetween,
  parseHoleGeometry,
  scopeHoleGeometry,
} from '../hole-geometry';
import { haversineKm } from '../geocode';
import rideauView from './fixtures/overpass-rideau-view.json';
import marshes from './fixtures/overpass-marshes-combined.json';
import royalOttawa from './fixtures/overpass-royal-ottawa-combined.json';

// Fixtures are REAL Overpass responses, captured Aug 2026:
// - overpass-rideau-view: `out geom` holes-only response for Rideau View GC
//   (18 golf=hole ways, refs 1–18, pars, tee→green polylines).
// - overpass-marshes-combined: the combined holes+boundaries query around The
//   Marshes (Ottawa) — 27 hole ways (the championship 18 + the 9-hole
//   Marchwood academy course, refs 1–9 duplicated) plus TWO named boundaries:
//   way "The Marchwood" and relation "The Marshes Golf Club" (2 outer ways).
// - overpass-royal-ottawa-combined: combined query around Royal Ottawa
//   (Gatineau) — 45 hole ways from THREE adjacent clubs, boundaries for
//   Royal Ottawa (closed way), Club de Golf Champlain (way) and Club de Golf
//   Chaudière (relation). Royal Ottawa's own boundary holds 27 holes
//   (18 + West Nine, refs duplicated) — the designed stays-null case.

describe('parseHoleGeometry', () => {
  it('parses a clean 18-hole course (real Rideau View response)', () => {
    const g = parseHoleGeometry(rideauView);
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(18);
    expect(g!.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    const h1 = g!.holes[0];
    expect(h1.par).toBeGreaterThanOrEqual(3);
    expect(h1.line.length).toBeGreaterThanOrEqual(2);
    // 6dp rounding, [lat,lng] order, plausibly at Rideau View (Manotick).
    expect(h1.line[0][0]).toBeGreaterThan(45.19);
    expect(h1.line[0][0]).toBeLessThan(45.21);
    expect(h1.line[0][1]).toBeLessThan(-75.6);
  });

  it('rejects duplicate refs — the Ottawa Hunt 27-hole ambiguity', () => {
    const dup = JSON.parse(JSON.stringify(rideauView)) as { elements: { tags: { ref: string } }[] };
    dup.elements[1].tags.ref = dup.elements[0].tags.ref;
    expect(parseHoleGeometry(dup)).toBeNull();
  });

  it('rejects unlabeled hole ways and short lines outright', () => {
    const noRef = JSON.parse(JSON.stringify(rideauView)) as { elements: { tags: { ref?: string } }[] };
    delete noRef.elements[4].tags.ref;
    expect(parseHoleGeometry(noRef)).toBeNull();

    const shortLine = JSON.parse(JSON.stringify(rideauView)) as {
      elements: { geometry: unknown[] }[];
    };
    shortLine.elements[2].geometry = shortLine.elements[2].geometry.slice(0, 1);
    expect(parseHoleGeometry(shortLine)).toBeNull();
  });

  it('rejects sub-9-hole coverage and junk payloads', () => {
    const few = { elements: (rideauView as { elements: unknown[] }).elements.slice(0, 5) };
    expect(parseHoleGeometry(few)).toBeNull();
    expect(parseHoleGeometry(null)).toBeNull();
    expect(parseHoleGeometry({})).toBeNull();
    expect(parseHoleGeometry({ elements: 'nope' })).toBeNull();
  });

  it('ignores non-hole golf features mixed into the response', () => {
    const mixed = JSON.parse(JSON.stringify(rideauView)) as { elements: unknown[] };
    mixed.elements.push({ type: 'way', tags: { golf: 'green' }, geometry: [] });
    const g = parseHoleGeometry(mixed);
    expect(g!.holes).toHaveLength(18);
  });
});

describe('courseNameScore', () => {
  it('matches through Club↔Course wording and generic filler', () => {
    expect(courseNameScore('Eagle Creek Golf Club', 'Eagle Creek Golf Course')).toBeGreaterThan(0);
    expect(courseNameScore('The Marshes Golf Club', 'The Marshes Golf Club')).toBeGreaterThan(0);
  });

  it('does NOT match sibling or neighbor courses', () => {
    expect(courseNameScore('The Marshes Golf Club', 'The Marchwood')).toBe(0);
    expect(courseNameScore('Royal Ottawa Golf Club', 'Club de Golf Champlain')).toBe(0);
  });

  it('folds accents (Chaudière ↔ Chaudiere)', () => {
    expect(courseNameScore('Club de Golf Chaudière', 'Chaudiere Golf Club')).toBeGreaterThan(0);
  });

  it('generic-only names can never match', () => {
    expect(courseNameScore('The Golf Club', 'Golf Course')).toBe(0);
  });
});

describe('scopeHoleGeometry', () => {
  it('the plain parse rejects both combined fixtures (duplicate refs)', () => {
    expect(parseHoleGeometry(marshes)).toBeNull();
    expect(parseHoleGeometry(royalOttawa)).toBeNull();
  });

  it('recovers The Marshes 18 by its relation boundary, excluding the Marchwood nine', () => {
    const g = scopeHoleGeometry(marshes, 'The Marshes Golf Club');
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(18);
    expect(g!.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('the same payload scoped to the Marchwood yields its own nine', () => {
    const g = scopeHoleGeometry(marshes, 'The Marchwood');
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(9);
  });

  it('Royal Ottawa stays null — its own boundary holds 27 holes with duplicate refs', () => {
    expect(scopeHoleGeometry(royalOttawa, 'Royal Ottawa Golf Club')).toBeNull();
  });

  it('scopes a neighbor club cleanly out of the same payload (closed-way boundary)', () => {
    // Champlain is a full 18 whose refs collide with Royal Ottawa's in the
    // shared radius; its own closed-way boundary separates them perfectly.
    const g = scopeHoleGeometry(royalOttawa, 'Club de Golf Champlain');
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(18);
    expect(g!.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('gives up without a name match, on ties, and on junk', () => {
    expect(scopeHoleGeometry(marshes, 'Pebble Beach Golf Links')).toBeNull();
    expect(scopeHoleGeometry(marshes, '')).toBeNull();
    expect(scopeHoleGeometry(null, 'The Marshes Golf Club')).toBeNull();
    expect(scopeHoleGeometry({ elements: 'nope' }, 'The Marshes Golf Club')).toBeNull();
    // Two boundaries tied on score → ambiguous → null.
    const tied = JSON.parse(JSON.stringify(marshes)) as {
      elements: { tags?: Record<string, string> }[];
    };
    for (const el of tied.elements) {
      if (el.tags?.leisure === 'golf_course') el.tags.name = 'Marshes Duplicate';
    }
    expect(scopeHoleGeometry(tied, 'Marshes Duplicate Golf Club')).toBeNull();
  });

  it('holes-only payloads (no boundaries at all) scope to null', () => {
    expect(scopeHoleGeometry(rideauView, 'Rideau View Golf Club')).toBeNull();
  });
});

describe('greenDistanceYards', () => {
  const g = parseHoleGeometry(rideauView)!;
  const hole1 = g.holes[0].line;
  const green = hole1[hole1.length - 1];

  it('matches an independent haversine computation from a nearby fix (±1 yd)', () => {
    // A fix offset ~150 yds south of the green (0.00124° of latitude).
    const fix: [number, number] = [green[0] - 0.00124, green[1]];
    const expected = Math.round(
      haversineKm({ lat: fix[0], lng: fix[1] }, { lat: green[0], lng: green[1] }) * 1093.6133
    );
    const got = greenDistanceYards(fix, hole1);
    expect(got).not.toBeNull();
    expect(Math.abs(got! - expected)).toBeLessThanOrEqual(1);
    expect(got!).toBeGreaterThan(100);
    expect(got!).toBeLessThan(200);
  });

  it('is measured to the LINE END (the green), not the tee', () => {
    const tee = hole1[0];
    // Standing ON the tee: distance ≈ the hole's playing length, not ~0.
    const fromTee = greenDistanceYards(tee, hole1)!;
    expect(fromTee).toBeGreaterThan(150);
    // Standing on the green: ~0.
    expect(greenDistanceYards(green, hole1)).toBe(0);
  });

  it('nulls past the sanity cap (couch-peek from downtown Ottawa) and on junk lines', () => {
    expect(greenDistanceYards([45.4215, -75.6972], hole1)).toBeNull(); // ~25 km away
    expect(greenDistanceYards(green, [green])).toBeNull(); // 1-point line
    expect(greenDistanceYards(green, [])).toBeNull();
  });
});

describe('polylineYards (hole length from the drawn way)', () => {
  const g = parseHoleGeometry(rideauView)!;
  const hole1 = g.holes[0].line;
  const tee = hole1[0];
  const green = hole1[hole1.length - 1];

  it('equals the straight-line yards for a 2-point way and grows for a dogleg', () => {
    const straight = polylineYards([tee, green])!;
    expect(straight).toBe(yardsBetween(tee, green));
    expect(straight).toBe(greenDistanceYards(tee, hole1));
    const dogleg: [number, number] = [(tee[0] + green[0]) / 2 + 0.001, (tee[1] + green[1]) / 2];
    expect(polylineYards([tee, dogleg, green])!).toBeGreaterThan(straight);
  });

  it('reads as a plausible hole length on the real Rideau View hole 1', () => {
    const yds = polylineYards(hole1)!;
    expect(yds).toBeGreaterThan(150);
    expect(yds).toBeLessThan(700);
    expect(yds).toBeGreaterThanOrEqual(greenDistanceYards(tee, hole1)!); // never shorter than the chord
  });

  it('nulls under two points', () => {
    expect(polylineYards([tee])).toBeNull();
    expect(polylineYards([])).toBeNull();
  });
});

describe('targetDistances (player-placed target on the focused hole)', () => {
  const g = parseHoleGeometry(rideauView)!;
  const hole1 = g.holes[0].line;
  const tee = hole1[0];
  const green = hole1[hole1.length - 1];
  const layup: [number, number] = [(tee[0] + green[0]) / 2, (tee[1] + green[1]) / 2];

  it('splits origin→target and target→green; the two legs cover the chord', () => {
    const d = targetDistances(tee, layup, hole1)!;
    expect(d.toTarget).toBeGreaterThan(0);
    expect(d.targetToGreen).toBeGreaterThan(0);
    // Triangle inequality with rounding slack: a midpoint target's legs sum to the chord.
    expect(Math.abs(d.toTarget + d.targetToGreen - greenDistanceYards(tee, hole1)!)).toBeLessThanOrEqual(2);
  });

  it('a target on the green leaves 0 to green; origin on the green is 0 to target', () => {
    expect(targetDistances(tee, green, hole1)!.targetToGreen).toBe(0);
    expect(targetDistances(green, green, hole1)!.toTarget).toBe(0);
  });

  it('never caps (a deliberate far target still reads) and nulls on junk lines', () => {
    const far: [number, number] = [45.4215, -75.6972]; // downtown Ottawa, ~25 km
    expect(targetDistances(tee, far, hole1)!.toTarget).toBeGreaterThan(1500);
    expect(targetDistances(tee, layup, [tee])).toBeNull();
    expect(targetDistances(tee, layup, [])).toBeNull();
  });
});
