import { describe, it, expect } from 'vitest';
import {
  cellBounds, cellKeyFor, cellPriority, cellQueryBbox, cellTier, elementsNear, holesUnchanged, metresToElement, overpassCellQuery,
  pickMirror, planCells, retryDelayMs, CELL_SIZE_DEG, CELL_TTL_MS, COURSE_RADIUS_M, OTTAWA_BOX, RETRY_DELAYS_MIN,
} from '../map-sweep';
import { isOverpassAnswer, resolveCourseTiers, resolveHoleGeometry, withGreens, type OverpassElement } from '../hole-geometry';
import rideauView from './fixtures/overpass-rideau-view.json';
import marshes from './fixtures/overpass-marshes-combined.json';
import royalOttawa from './fixtures/overpass-royal-ottawa-combined.json';
import ottawaHunt from './fixtures/ottawa-hunt-overpass.json';
import amberwood from './fixtures/overpass-amberwood.json';
import emeraldLinks from './fixtures/overpass-emerald-links.json';
import greensmere from './fixtures/overpass-greensmere.json';

// Map sweep PR 6 — the pure half: cells, the planner, the query, the
// envelope guard, the SEGMENT-distance filter, and the equivalence that
// matters: the regional payload, filtered per course, answers EXACTLY what
// the lazy per-course query answers (the four historical captures and the
// three new ones all sit in one or two Ottawa cells).

const M = (2 * Math.PI * 6371000) / 360;
const elementsOf = (fx: unknown) => (fx as { elements: OverpassElement[] }).elements;
const courseOf = (fx: unknown) => (fx as { _course: { name: string; lat: number; lng: number } })._course;

describe('cell keys and bounds', () => {
  it('names the SW corner at 0.5°, both hemispheres, and never prints -0', () => {
    expect(cellKeyFor(45.3, -75.7)).toBe('c05:45.0:-76.0');
    expect(cellKeyFor(45.75, -75.25)).toBe('c05:45.5:-75.5');
    expect(cellKeyFor(-33.9, 151.2)).toBe('c05:-34.0:151.0');
    expect(cellKeyFor(0.1, -0.2)).toBe('c05:0.0:-0.5');
    expect(cellKeyFor(0.0, 0.0)).toBe('c05:0.0:0.0');
    expect(cellKeyFor(89.9, 179.9)).toBe('c05:89.5:179.5');
    expect(cellKeyFor(-0.3, -180)).toBe('c05:-0.5:-180.0');
  });
  it('bounds round-trip and refuse junk', () => {
    expect(cellBounds('c05:45.0:-76.0')).toEqual({ lat0: 45, lng0: -76, lat1: 45.5, lng1: -75.5 });
    expect(cellBounds('c05:45.3:-76.0')).toBeNull(); // not on the grid
    expect(cellBounds('c05:95.0:-76.0')).toBeNull();
    expect(cellBounds('c1:45.0:-76.0')).toBeNull();
    expect(cellBounds('junk')).toBeNull();
    expect(CELL_SIZE_DEG).toBe(0.5);
  });
  it('the query bbox carries the cos-scaled margin and the in-band timeout', () => {
    const b = cellQueryBbox('c05:45.0:-76.0')!;
    expect(b.south).toBeCloseTo(44.97, 6);
    expect(b.north).toBeCloseTo(45.53, 6);
    expect(b.west).toBeLessThan(-76.03);
    expect(b.east - b.west).toBeGreaterThan(0.5 + 0.06);
    const q = overpassCellQuery(b);
    expect(q).toContain('[timeout:20]');
    expect(q).toContain('way["golf"="hole"]');
    expect(q).toContain('relation["golf"="green"]');
    expect(q).toContain('way["leisure"="golf_course"]["name"]');
    expect(q).toContain('out center;');
    expect(cellQueryBbox('junk')).toBeNull();
  });
});

describe('the planner', () => {
  const c = (id: string, lat: number, lng: number, cc: string | null, src = 'osm') => ({ id, lat, lng, country_code: cc, external_source: src });
  it('groups by cell, tiers (Ottawa / rounds → 0, CA → 1, US-GB-IE-AU → 2, rest → 3), orders by priority', () => {
    const cells = planCells(
      [c('a', 45.3, -75.7, 'CA'), c('b', 45.31, -75.71, 'CA'), c('t', 43.6, -79.4, 'CA'), c('u', 40.7, -74.0, 'US'), c('x', -33.9, 151.2, 'AU'), c('z', 48.8, 2.3, 'FR'), c('n', 10.1, 10.1, null), c('q', 45.3, -75.7, 'CA', 'qa-e2e'), c('nocoord', null as unknown as number, null as unknown as number, 'CA')],
      new Map([['u', 3]])
    );
    expect(cells.map(x => `${x.cell_key}:${x.tier}:${x.courses}`)).toEqual([
      'c05:40.5:-74.0:0:1', // a recorded round beats everything
      'c05:45.0:-76.0:0:2', // Tom's box
      'c05:43.5:-79.5:1:1',
      'c05:-34.0:151.0:2:1',
      'c05:10.0:10.0:3:1',
      'c05:48.5:2.0:3:1',
    ]);
    expect(cells[0].rounds).toBe(3);
    expect(cellTier([{ lat: 45.3, lng: -75.7, country_code: null }], 0)).toBe(0);
    expect(OTTAWA_BOX.south).toBe(45.1);
  });
  it('priority: the tier first, then the busiest, then the biggest', () => {
    expect(cellPriority(0, 5, 10)).toBeLessThan(cellPriority(0, 0, 100));
    expect(cellPriority(1, 999, 999)).toBeGreaterThan(cellPriority(0, 0, 1));
    expect(cellPriority(2, 0, 50)).toBeLessThan(cellPriority(2, 0, 10));
  });
});

describe('isOverpassAnswer + the segment-distance filter', () => {
  it('the recorded fixtures carry the envelope (the Ottawa Hunt capture is a resolver fixture — wrapped)', () => {
    for (const fx of [rideauView, marshes, royalOttawa, amberwood, emeraldLinks, greensmere]) expect(isOverpassAnswer(fx)).toBe(true);
    expect(isOverpassAnswer(ottawaHunt)).toBe(false);
    expect(isOverpassAnswer({ version: 0.6, ...ottawaHunt })).toBe(true);
  });
  it('a way whose vertices are 1.8 km away while its segment passes 1.2 km from the point IS near (Overpass semantics)', () => {
    const p: [number, number] = [45.3, -75.7];
    const kx = Math.cos((45.3 * Math.PI) / 180);
    // A due-east segment 1,200 m north of the point, from 1,340 m west to 1,340 m east — its vertices are 1.8 km away.
    const way: OverpassElement = { type: 'way', tags: { golf: 'hole', ref: '1' }, geometry: [{ lat: 45.3 + 1200 / M, lon: -75.7 - 1340 / (M * kx) }, { lat: 45.3 + 1200 / M, lon: -75.7 + 1340 / (M * kx) }] };
    expect(Math.round(metresToElement(p, way))).toBe(1200);
    expect(elementsNear([way], p)).toHaveLength(1);
    const far: OverpassElement = { ...way, geometry: way.geometry!.map(g => ({ ...g, lat: g.lat + 400 / M })) };
    expect(elementsNear([far], p)).toHaveLength(0);
    expect(COURSE_RADIUS_M).toBe(1500);
    // Points: a node, a `center` way, a relation's members.
    const node = { type: 'node', tags: { golf: 'tee', ref: '1' }, lat: 45.3 + 100 / M, lon: -75.7 } as unknown as OverpassElement;
    expect(Math.round(metresToElement(p, node))).toBe(100);
    const centred = { type: 'way', tags: { golf: 'fairway', ref: '1' }, center: { lat: 45.3 + 200 / M, lon: -75.7 } } as unknown as OverpassElement;
    expect(Math.round(metresToElement(p, centred))).toBe(200);
  });
});

describe('equivalence: the regional payload filtered per course answers what the lazy query answers', () => {
  // One regional payload: every Ottawa capture's elements, deduplicated by (type, id).
  const regional: OverpassElement[] = (() => {
    const seen = new Set<string>();
    const out: OverpassElement[] = [];
    for (const fx of [rideauView, marshes, royalOttawa, amberwood, emeraldLinks, greensmere]) {
      for (const el of elementsOf(fx)) {
        const key = `${el.type}/${(el as { id?: number }).id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(el);
      }
    }
    return out;
  })();
  const centroidOf = (fx: unknown): [number, number] => {
    const holes = elementsOf(fx).filter(e => e.tags?.golf === 'hole');
    const pts = holes.flatMap(h => (h.geometry ?? []).map(g => [g.lat, g.lon] as [number, number]));
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };
  const same = (a: unknown, b: unknown) => expect(JSON.stringify(a)).toBe(JSON.stringify(b));

  it('Rideau View (no boundary): 18 lines, greens — identical bytes', () => {
    const point = centroidOf(rideauView);
    const near = elementsNear(regional, point);
    const lazy = resolveCourseTiers(rideauView, { name: 'Rideau View Golf Club', lat: point[0], lng: point[1] });
    const swept = resolveCourseTiers({ version: 0.6, elements: near }, { name: 'Rideau View Golf Club', lat: point[0], lng: point[1] });
    expect(lazy.geometry?.holes).toHaveLength(18);
    same(swept.geometry, lazy.geometry);
    expect(swept.tier).toBe('lines');
  });
  it('The Marshes by its relation boundary; The Marchwood its own nine; Champlain by its closed-way boundary', () => {
    for (const [fx, name] of [[marshes, 'The Marshes Golf Club'], [marshes, 'The Marchwood'], [royalOttawa, 'Club de Golf Champlain']] as const) {
      const point = centroidOf(fx);
      const lazy = resolveCourseTiers(fx, { name, lat: point[0], lng: point[1] });
      const swept = resolveCourseTiers({ version: 0.6, elements: elementsNear(regional, point) }, { name, lat: point[0], lng: point[1] });
      expect(lazy.geometry, name).not.toBeNull();
      same(swept.geometry, lazy.geometry);
    }
  });
  it('Royal Ottawa (its own 27, a hub near-tie) stays null both ways, with the same reason', () => {
    const c = courseOf(royalOttawa as unknown as { _course: unknown }) ?? null;
    const point: [number, number] = c ? [c.lat, c.lng] : centroidOf(royalOttawa);
    const lazy = resolveCourseTiers(royalOttawa, { name: 'Royal Ottawa Golf Club', lat: point[0], lng: point[1], holesCount: 18 });
    const swept = resolveCourseTiers({ version: 0.6, elements: elementsNear(regional, point) }, { name: 'Royal Ottawa Golf Club', lat: point[0], lng: point[1], holesCount: 18 });
    expect(lazy.geometry).toBeNull();
    expect(swept.geometry).toBeNull();
    expect(swept.reason).toBe(lazy.reason);
  });
  it('Amberwood (features), Emerald Links (loops) and Greensmere (greens-only) answer the same tier either way', () => {
    for (const [fx, holesCount, tier] of [[amberwood, 9, 'features'], [emeraldLinks, 27, 'loops'], [greensmere, 36, 'greens_only']] as const) {
      const c = courseOf(fx);
      const lazy = resolveCourseTiers(fx, { name: c.name, lat: c.lat, lng: c.lng, holesCount });
      const swept = resolveCourseTiers({ version: 0.6, elements: elementsNear(regional, [c.lat, c.lng]) }, { name: c.name, lat: c.lat, lng: c.lng, holesCount });
      expect(lazy.tier, c.name).toBe(tier);
      same(swept.geometry, lazy.geometry);
    }
  });
  it('the historical resolver and the pipeline agree on the strict tier', () => {
    const point = centroidOf(rideauView);
    const direct = withGreens(resolveHoleGeometry(rideauView, 'Rideau View Golf Club', point)!, rideauView);
    same(resolveCourseTiers(rideauView, { name: 'Rideau View Golf Club', lat: point[0], lng: point[1] }).geometry, direct);
  });
});

describe('bookkeeping', () => {
  it('holesUnchanged compares the lines point for point and nothing else', () => {
    const g = { holes: [{ hole: 1, par: 4, line: [[45.3, -75.7], [45.303, -75.7]] as [number, number][] }], source: 'osm' as const };
    expect(holesUnchanged(g, { ...g, greens: [] })).toBe(true);
    expect(holesUnchanged(g, { ...g, holes: [{ ...g.holes[0], line: [[45.3, -75.7], [45.3031, -75.7]] }] })).toBe(false);
    expect(holesUnchanged(null, null)).toBe(true);
    expect(holesUnchanged(g, null)).toBe(false);
  });
  it('retry delays climb and cap; cooling mirrors go last; the cell TTL beats the lazy 30 days', () => {
    expect(retryDelayMs(1)).toBe(5 * 60_000);
    expect(retryDelayMs(3)).toBe(45 * 60_000);
    expect(retryDelayMs(99)).toBe(RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1] * 60_000);
    const now = Date.now();
    expect(pickMirror(['a', 'b', 'c'], { a: new Date(now + 60_000).toISOString(), c: new Date(now - 1).toISOString() }, now)).toEqual(['b', 'c', 'a']);
    expect(CELL_TTL_MS).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });
});
