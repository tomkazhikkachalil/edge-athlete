import { describe, expect, it } from 'vitest';
import {
  courseNameScore,
  greenDistanceYards,
  isOverpassPartial,
  polylineYards,
  targetDistances,
  trimLineToYards,
  yardsBetween,
  parseHoleGeometry,
  resolveHoleGeometry,
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

  it('tokenizes non-Latin and non-decomposing Latin names (worldwide catalog)', () => {
    expect(courseNameScore('小金井カントリー倶楽部', '小金井カントリー倶楽部')).toBeGreaterThan(0);
    expect(courseNameScore('Гольф-клуб Москва', 'Гольф-клуб Москва')).toBeGreaterThan(0);
    // "гольф"/"клуб" aren't in the (English) generic list, so they count — 2 shared, "москва" not among them.
    expect(courseNameScore('Гольф-клуб Москва', 'Гольф-клуб Сколково')).toBe(2);
    expect(courseNameScore('Гольф-клуб Москва', 'Гольф-клуб Москва')).toBe(3);
    expect(courseNameScore('Søllerød Golf Klub', 'Søllerød Golf Club')).toBeGreaterThan(0);
    expect(courseNameScore('Søllerød Golf Klub', 'Rungsted Golf Klub')).toBe(1); // "klub" only — no shredded "s"/"d"
  });

  it("drops single letters (possessive 's) but keeps single digits", () => {
    expect(courseNameScore("King's Golf Club", "Queen's Golf Course")).toBe(0);
    expect(courseNameScore('Pinehurst No. 2', 'Pinehurst No. 8')).toBe(2); // pinehurst + no — the digit still separates them
    expect(courseNameScore('Pinehurst No. 2', 'Pinehurst No. 2')).toBe(3);
  });
});

describe('isOverpassPartial (HTTP 200 with an in-band runtime error)', () => {
  it('flags timeout and memory remarks', () => {
    expect(isOverpassPartial({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' })).toBe(true);
    expect(isOverpassPartial({ remark: 'runtime error: Query ran out of memory in "recurse" at line 2.' })).toBe(true);
  });

  it('ignores informational remarks and payloads without one', () => {
    expect(isOverpassPartial({ elements: [], remark: 'Some informational note' })).toBe(false);
    expect(isOverpassPartial(rideauView)).toBe(false);
    expect(isOverpassPartial(null)).toBe(false);
    expect(isOverpassPartial({})).toBe(false);
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

  it('collapses OSM double-tagging (way + same-named relation, same ring) instead of tying to null', () => {
    type El = { type: string; id?: number; tags?: Record<string, string>; geometry?: unknown[]; members?: unknown[] };
    const doubled = JSON.parse(JSON.stringify(royalOttawa)) as { elements: El[] };
    const champlain = doubled.elements.find(el => el.tags?.name === 'Club de Golf Champlain' && el.type === 'way')!;
    doubled.elements.push({
      type: 'relation',
      id: 999999,
      tags: { type: 'multipolygon', leisure: 'golf_course', name: 'Club de Golf Champlain' },
      members: [{ type: 'way', ref: champlain.id, role: 'outer', geometry: champlain.geometry }],
    });
    const g = scopeHoleGeometry(doubled, 'Club de Golf Champlain');
    expect(g).not.toBeNull();
    expect(g!.holes).toHaveLength(18);
  });

  it('a same-named boundary with DIFFERENT geometry is still an ambiguity (null)', () => {
    type El = { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: unknown[] };
    const clashed = JSON.parse(JSON.stringify(royalOttawa)) as { elements: El[] };
    const champlain = clashed.elements.find(el => el.tags?.name === 'Club de Golf Champlain' && el.type === 'way')!;
    // Shift the copy ~1 km north: same name, different ring.
    const shifted = champlain.geometry!.map(g => ({ lat: g.lat + 0.01, lon: g.lon }));
    clashed.elements.push({ type: 'way', tags: { leisure: 'golf_course', name: 'Club de Golf Champlain' }, geometry: shifted });
    expect(scopeHoleGeometry(clashed, 'Club de Golf Champlain')).toBeNull();
  });
});

describe('scoping rules (review follow-ups, Aug 24)', () => {
  type El = { type: string; id?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: unknown[] };
  const clone = (x: unknown): unknown => JSON.parse(JSON.stringify(x));
  const ringCentroid = (el: El): [number, number] => {
    const g = el.geometry!;
    return [g.reduce((a, p) => a + p.lat, 0) / g.length, g.reduce((a, p) => a + p.lon, 0) / g.length];
  };

  it('a neighbour sharing one name token is NOT this course (identity leads with the first token)', () => {
    // Champlain's boundary renamed "Ottawa Golf Course": a single shared token
    // ("ottawa") that is NOT Royal Ottawa's leading token ("royal"). The old
    // score-≥-1 rule served Champlain's 18 under Royal Ottawa. Distance can't
    // help — the clubs are adjacent (477 m centroid-to-ring, measured).
    const payload = clone(royalOttawa) as { elements: El[] };
    for (const el of payload.elements) {
      if (el.tags?.name === 'Club de Golf Champlain') el.tags.name = 'Ottawa Golf Course';
      if (el.tags?.name === 'Royal Ottawa Golf Club') el.tags.name = 'Club X';
    }
    expect(scopeHoleGeometry(payload, 'Royal Ottawa Golf Club')).toBeNull();
    expect(scopeHoleGeometry(royalOttawa, 'Ottawa Valley Golf Club')).toBeNull();
    // A one-token identity that DOES lead still works: "Champlain" is the club.
    expect(scopeHoleGeometry(royalOttawa, 'Champlain')!.holes).toHaveLength(18);
  });

  it('proximity is a coarse guard: a same-name ring a few km away is ignored, not tied', () => {
    const payload = clone(marshes) as { elements: El[] };
    const real = payload.elements.find(e => e.tags?.name === 'The Marshes Golf Club')!;
    const point: [number, number] = ringCentroid(
      payload.elements.find(e => e.type === 'way' && e.tags?.name === 'The Marchwood')!
    );
    // A second "The Marshes Golf Club" polygon 5 km north (different ring).
    const far = clone(real) as El;
    far.type = 'way';
    far.id = 999;
    delete far.members;
    far.geometry = Array.from({ length: 5 }, (_, i) => ({ lat: point[0] + 0.045 + (i % 2) * 0.002, lon: point[1] + (i > 1 ? 0.002 : 0) }));
    far.geometry.push(far.geometry[0]);
    payload.elements.push(far);
    expect(scopeHoleGeometry(payload, 'The Marshes Golf Club')).toBeNull(); // no point: two rings, one name → ambiguous
    expect(scopeHoleGeometry(payload, 'The Marshes Golf Club', point)!.holes).toHaveLength(18); // with the point: far ring dropped
  });

  it('a matching boundary is authoritative: unmapped holes do not inherit the neighbour’s 18', () => {
    // Remove the Marchwood nine. The plain parse of what remains is the
    // Marshes' clean 18 — which the old order returned for "The Marchwood".
    const marchwood = scopeHoleGeometry(marshes, 'The Marchwood')!;
    const starts = new Set(marchwood.holes.map(h => `${h.line[0][0]},${h.line[0][1]}`));
    const trimmed = clone(marshes) as { elements: El[] };
    trimmed.elements = trimmed.elements.filter(el => {
      if (el.tags?.golf !== 'hole' || !el.geometry?.length) return true;
      const g = el.geometry[0];
      return !starts.has(`${Number(g.lat.toFixed(6))},${Number(g.lon.toFixed(6))}`);
    });
    expect(parseHoleGeometry(trimmed)!.holes).toHaveLength(18); // plain parse WOULD accept
    expect(resolveHoleGeometry(trimmed, 'The Marchwood')).toBeNull(); // its own boundary holds nothing
    expect(resolveHoleGeometry(trimmed, 'The Marshes Golf Club')!.holes).toHaveLength(18);
    // No boundary at all (Rideau View's holes-only payload) → the plain parse, as before.
    expect(resolveHoleGeometry(rideauView, 'Rideau View Golf Club')!.holes).toHaveLength(18);
  });

  it('containment is by majority of vertices, not the single midpoint', () => {
    // Push one Marshes hole's middle vertex a degree away: the midpoint rule
    // dropped that hole silently (17 served as valid); majority keeps it.
    const payload = clone(marshes) as { elements: El[] };
    const marshesHoles = scopeHoleGeometry(marshes, 'The Marshes Golf Club')!;
    const target = marshesHoles.holes[4];
    const el = payload.elements.find(e => e.tags?.golf === 'hole' && e.geometry &&
      Number(e.geometry[0].lat.toFixed(6)) === target.line[0][0] && Number(e.geometry[0].lon.toFixed(6)) === target.line[0][1])!;
    const mid = Math.floor(el.geometry!.length / 2);
    el.geometry![mid] = { lat: el.geometry![mid].lat + 1, lon: el.geometry![mid].lon };
    expect(scopeHoleGeometry(payload, 'The Marshes Golf Club')!.holes).toHaveLength(18);
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

describe('trimLineToYards (start the hole at the tee-in-play)', () => {
  const g = parseHoleGeometry(rideauView)!;
  const hole1 = g.holes[0].line;
  const tee = hole1[0];
  const green = hole1[hole1.length - 1];
  const drawn = polylineYards(hole1)!;

  it('returns the line unchanged for missing, invalid, or ≥-length yardage', () => {
    expect(trimLineToYards(hole1, undefined)).toBe(hole1);
    expect(trimLineToYards(hole1, null)).toBe(hole1);
    expect(trimLineToYards(hole1, 0)).toBe(hole1);
    expect(trimLineToYards(hole1, NaN)).toBe(hole1);
    expect(trimLineToYards(hole1, drawn)).toBe(hole1);
    expect(trimLineToYards(hole1, drawn + 50)).toBe(hole1);
    expect(trimLineToYards([tee], 100)).toEqual([tee]);
  });

  it('starts exactly the scorecard yardage from the green, on the drawn line', () => {
    const played = trimLineToYards(hole1, 150);
    expect(played[played.length - 1]).toEqual(green);
    expect(played.length).toBeLessThanOrEqual(hole1.length);
    expect(Math.abs(polylineYards(played)! - 150)).toBeLessThanOrEqual(1);
    expect(played[0]).not.toEqual(tee);
    // Interpolated, so the new start sits on the segment it landed in.
    expect(Math.abs(yardsBetween(played[0], green) - 150)).toBeLessThanOrEqual(2 + (drawn - 150) / 100);
  });

  it('interpolates on the correct segment of a dogleg (first vs later)', () => {
    const a: [number, number] = [45.2, -75.7];
    const b: [number, number] = [45.203, -75.7]; // ~365 yds north of a
    const c: [number, number] = [45.203, -75.696]; // ~343 yds east of b
    const dogleg = [a, b, c];
    const total = polylineYards(dogleg)!;
    // Inside the LAST segment (b→c): start lies between b and c on b's latitude.
    const short = trimLineToYards(dogleg, 100);
    expect(short).toHaveLength(2);
    expect(short[0][0]).toBeCloseTo(45.203, 5);
    expect(Math.abs(polylineYards(short)! - 100)).toBeLessThanOrEqual(1);
    // Inside the FIRST segment (a→b): keeps b as an interior vertex.
    const long = trimLineToYards(dogleg, total - 100);
    expect(long).toHaveLength(3);
    expect(long[1]).toEqual(b);
    expect(long[0][1]).toBeCloseTo(-75.7, 5);
    expect(Math.abs(polylineYards(long)! - (total - 100))).toBeLessThanOrEqual(1);
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
