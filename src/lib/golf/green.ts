// ── The green as a shape (Golf course flow fixes, PR G1, Oct 2026) ──────────
// OSM maps most greens as closed `golf=green` ways. With the outline, a
// player's position gives THREE numbers instead of one: the distance to the
// FRONT edge, to the CENTRE and to the BACK edge — the rangefinder trio every
// golfer reads. Nothing here guesses a pin: no pin data exists anywhere, and
// a green with no outline keeps its one "to green" number (the hole line's
// last point, `greenDistanceYards`).
//
// Pure maths, zero React, zero I/O. The centre is the ring's area-weighted
// centroid (OSM hole lines are hand-drawn and routinely stop at the front
// edge, so the line end is NOT a stable centre). Front and back are where
// the ray from the player THROUGH the centre crosses the ring: the first
// crossing before the centre is the front edge, the last crossing past it the
// back edge. A player standing ON the green has neither.
//
// Also the home of `pointInRing` and `YDS_PER_KM` (moved out of
// hole-geometry.ts so that module can import from here without a cycle).

import { haversineKm } from '@/lib/golf/geocode';

/** [lat,lng] vertices; the ring may arrive closed (first === last) or open —
 *  every function here closes it virtually. */
export type Ring = [number, number][];

/** Yards per kilometre — the one conversion every yardage uses. */
export const YDS_PER_KM = 1093.6133;

/** Metres per degree of latitude on the same sphere haversineKm uses
 *  (2π · 6371 km / 360). Longitude scales by cos(lat). */
const M_PER_DEG = (2 * Math.PI * 6371000) / 360;

/** Ray-cast point-in-ring; lat is y, lng is x. Works on open and closed
 *  rings alike (the edge from the last vertex back to the first is implied). */
export function pointInRing(pt: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/** The ring's vertices with a closing duplicate removed and consecutive
 *  duplicates collapsed. */
function distinctVertices(ring: Ring): Ring {
  const out: Ring = [];
  for (const v of ring) {
    if (!Array.isArray(v) || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
    if (out.length && samePoint(out[out.length - 1], v)) continue;
    out.push(v);
  }
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** A local equirectangular frame in metres around `origin` — x east, y north. */
function toLocal(origin: [number, number]) {
  const kx = M_PER_DEG * Math.cos((origin[0] * Math.PI) / 180);
  return (p: [number, number]): [number, number] => [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * M_PER_DEG];
}

/** The area-weighted centroid of a ring (shoelace, in a local frame); the
 *  vertex mean when the ring has no area. Null under three distinct vertices. */
export function ringCentroid(ring: Ring): [number, number] | null {
  const v = distinctVertices(ring);
  if (v.length < 3) return null;
  const origin = v[0];
  const local = toLocal(origin);
  const pts = v.map(local);
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  let mx: number;
  let my: number;
  if (Math.abs(area) < 1e-6) {
    mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  } else {
    mx = cx / (3 * area);
    my = cy / (3 * area);
  }
  const kx = M_PER_DEG * Math.cos((origin[0] * Math.PI) / 180);
  return [
    Number((origin[0] + my / M_PER_DEG).toFixed(7)),
    Number((origin[1] + mx / kx).toFixed(7)),
  ];
}

/** Parameters t along the line from→to (t = 0 at `from`, 1 at `to`, the line
 *  extended both ways) where it crosses the ring's edges, ascending. */
export function ringCrossings(from: [number, number], to: [number, number], ring: Ring): number[] {
  const v = distinctVertices(ring);
  if (v.length < 3) return [];
  const local = toLocal(from);
  const [dx, dy] = local(to);
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return [];
  const pts = v.map(local);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue; // parallel edge
    // from + t·d = a + u·e
    const t = (ax * ey - ay * ex) / denom;
    const u = (ax * dy - ay * dx) / denom;
    if (u >= 0 && u < 1) out.push(t);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** The nearest of several rings to a position (by centroid) and its trio —
 *  the greens-only rangefinder (sweep PR 3): a course whose greens are
 *  drawn but not numbered still answers "how far to the green ahead".
 *  Null without a usable ring. */
export function nearestGreen(fix: [number, number], rings: Ring[]): { index: number; ring: Ring; distances: GreenDistances } | null {
  let best: { index: number; ring: Ring; distances: GreenDistances } | null = null;
  rings.forEach((ring, index) => {
    const d = greenDistances(fix, ring);
    if (d && (!best || d.centre < best.distances.centre)) best = { index, ring, distances: d };
  });
  return best;
}

export interface GreenDistances {
  /** Yards to the front edge; null on the green or with no clean crossing. */
  front: number | null;
  /** Yards to the centre (the centroid). */
  centre: number;
  /** Yards to the back edge; null on the green or with no clean crossing. */
  back: number | null;
}

/** The rangefinder trio from a position to a green outline, in rounded
 *  yards. The centre is the great-circle distance to the centroid (the same
 *  sphere as every other yardage); front and back are the ring crossings of
 *  the ray player → centre, scaled onto that distance. Null only when the
 *  ring is degenerate (under three distinct vertices). */
export function greenDistances(fix: [number, number], ring: Ring): GreenDistances | null {
  const centroid = ringCentroid(ring);
  if (!centroid) return null;
  const centreKm = haversineKm({ lat: fix[0], lng: fix[1] }, { lat: centroid[0], lng: centroid[1] });
  const centreYds = centreKm * YDS_PER_KM;
  const centre = Math.round(centreYds);
  if (pointInRing(fix, ring) || centreYds < 0.5) return { front: null, centre, back: null };
  const ts = ringCrossings(fix, centroid, ring);
  const before = ts.filter(t => t > 0 && t < 1);
  const after = ts.filter(t => t > 1);
  if (!before.length || !after.length) return { front: null, centre, back: null };
  return {
    front: Math.round(before[0] * centreYds),
    centre,
    back: Math.round(after[after.length - 1] * centreYds),
  };
}
