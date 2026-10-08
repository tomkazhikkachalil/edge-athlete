// ── Feature-derived hole lines (map sweep PR 5, Oct 2026) ───────────────────
// OSM has TWO ways of mapping a golf course. The one we always read draws
// each hole as a `golf=hole` way (tee → green). The other tags the FEATURES
// — `golf=tee`, `golf=fairway`, `golf=green` — each with `ref` = the hole
// number, and draws no hole way at all (Amberwood: nine numbered tees,
// fairways and greens, zero lines). Tier 4 synthesises a line per hole
// from those: the back tee → (the fairway's centre, when it lies along
// the way) → the green's centre. Every line is verified alone (its ref, its
// length), and the geometry is valid only on ≥ 9 uniquely numbered greens;
// a ref that names two greens far apart is a different course's or a
// mapper's error, and the whole derivation is null — never partial trust.
// The stored geometry carries `derived: 'features'` so the UI can say so;
// the lengths already read "≈" (they are drawn lengths, not the card's).

import type { GreenRing, HoleGeometry, HoleLine, OverpassElement } from '@/lib/golf/hole-geometry';
import { ringArea, ringCentroid, YDS_PER_KM, type Ring } from '@/lib/golf/green';
import { haversineKm } from '@/lib/golf/geocode';

export type FeatureKind = 'tee' | 'fairway' | 'green';

export interface GolfFeature {
  kind: FeatureKind;
  ref: number;
  /** A representative point: a node's position, a way's `center`, or a ring's centroid. */
  point: [number, number];
  /** The closed outline when the feature is a polygon (greens always; tees sometimes). */
  ring?: Ring;
  par: number | null;
}

/** A geometry needs this many uniquely numbered greens to be trusted. */
export const DERIVED_MIN_GREENS = 9;
/** A synthesised line outside this range is a tagging error — dropped, the green kept. */
export const DERIVED_MIN_LINE_YDS = 60;
export const DERIVED_MAX_LINE_YDS = 800;
/** Several green rings sharing one ref within this distance are one green. */
export const GREEN_SAME_M = 60;
/** Far apart, the ring at least this many times the area of every other
 *  same-ref ring is the hole's green (a mis-tagged practice green beside
 *  a real one — Amberwood's 9th: 366 m² vs 105 m²); comparable sizes stay
 *  ambiguous. */
export const GREEN_DOMINANT_AREA = 2;
/** A tee farther than this from its green belongs to a neighbour's hole. */
export const TEE_MAX_FROM_GREEN_M = 800;
/** The fairway's centre becomes the line's bend only when it sits along the
 *  tee → green chord (0.1 < t < 0.9) and within this of it. */
export const FAIRWAY_MAX_OFFSET_M = 150;

const metres = (a: [number, number], b: [number, number]) => haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;
const isFeatureKind = (v: unknown): v is FeatureKind => v === 'tee' || v === 'fairway' || v === 'green';
const validPt = (g: { lat: number; lon: number } | undefined) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon);

/** The point an element stands for, whatever shape Overpass returned it in. */
export function featurePoint(el: OverpassElement): [number, number] | null {
  const e = el as OverpassElement & { lat?: number; lon?: number; center?: { lat: number; lon: number } };
  if (Array.isArray(el.geometry) && el.geometry.length) {
    const ring = el.geometry.filter(validPt).map(g => [g.lat, g.lon] as [number, number]);
    if (ring.length >= 3) {
      const c = ringCentroid(ring);
      if (c) return c;
    }
    if (ring.length) return ring[0];
  }
  if (e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon)) return [e.center.lat, e.center.lon];
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) return [e.lat!, e.lon!];
  return null;
}

/** The numbered golf features of a payload. Features without a numeric
 *  `ref` are dropped silently — an unnumbered practice green is normal. */
export function parseGolfFeatures(elements: OverpassElement[]): GolfFeature[] {
  const out: GolfFeature[] = [];
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (!isFeatureKind(tags.golf)) continue;
    if (!/^\d+$/.test(tags.ref ?? '')) continue;
    const point = featurePoint(el);
    if (!point) continue;
    const ring = Array.isArray(el.geometry) && el.geometry.length >= 4
      ? el.geometry.filter(validPt).map(g => [Number(g.lat.toFixed(6)), Number(g.lon.toFixed(6))] as [number, number])
      : undefined;
    out.push({
      kind: tags.golf,
      ref: Number(tags.ref),
      point,
      ...(ring && ring.length >= 4 ? { ring } : {}),
      par: /^\d+$/.test(tags.par ?? '') ? Number(tags.par) : null,
    });
  }
  return out;
}

/** The green for a ref: one ring; several within GREEN_SAME_M → the
 *  largest; several farther apart → the one GREEN_DOMINANT_AREA× bigger
 *  than every other, else `'ambiguous'`. */
function greenFor(greens: GolfFeature[]): GolfFeature | 'ambiguous' | null {
  if (!greens.length) return null;
  if (greens.length === 1) return greens[0];
  const areas = greens.map(g => (g.ring ? ringArea(g.ring) : 0));
  const order = greens.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const big = order[0];
  const clustered = greens.every(g => metres(greens[big].point, g.point) <= GREEN_SAME_M);
  if (clustered) return greens[big];
  const second = areas[order[1]];
  if (areas[big] >= GREEN_DOMINANT_AREA * second && second > 0) return greens[big];
  return 'ambiguous';
}

/** Synthesise the hole lines. Null under DERIVED_MIN_GREENS greens or on an
 *  ambiguous green ref. A hole may lack a line (no tee) and keep its green.
 *  Exported pure for tests. */
export function deriveHoleGeometry(features: GolfFeature[]): HoleGeometry | null {
  const byRef = new Map<number, GolfFeature[]>();
  for (const f of features) byRef.set(f.ref, [...(byRef.get(f.ref) ?? []), f]);
  const holes: HoleLine[] = [];
  const greens: GreenRing[] = [];
  for (const [ref, fs] of [...byRef.entries()].sort((a, b) => a[0] - b[0])) {
    if (ref < 1 || ref > 36) continue;
    const green = greenFor(fs.filter(f => f.kind === 'green'));
    if (green === 'ambiguous') return null;
    if (!green || !green.ring) continue;
    const centre = ringCentroid(green.ring) ?? green.point;
    greens.push({ hole: ref, ring: green.ring });
    // The back tee: the farthest tee from the green within the sanity band.
    const tees = fs.filter(f => f.kind === 'tee' && metres(f.point, centre) <= TEE_MAX_FROM_GREEN_M);
    if (!tees.length) continue;
    const tee = tees.reduce((far, t) => (metres(t.point, centre) > metres(far.point, centre) ? t : far), tees[0]);
    // Par: what the features agree on; a disagreement is no par at all.
    const pars = new Set(fs.map(f => f.par).filter((p): p is number => p != null));
    const par = pars.size === 1 ? [...pars][0] : null;
    // The fairway's centre bends the line only when it lies along the chord.
    const line: [number, number][] = [tee.point];
    const fairway = fs.find(f => f.kind === 'fairway');
    if (fairway) {
      const t = projectOnChord(tee.point, centre, fairway.point);
      if (t.t > 0.1 && t.t < 0.9 && t.offsetM <= FAIRWAY_MAX_OFFSET_M) line.push(fairway.point);
    }
    line.push(centre);
    const yds = (metres(line[0], line[line.length - 1]) / 1000) * YDS_PER_KM;
    if (yds < DERIVED_MIN_LINE_YDS || yds > DERIVED_MAX_LINE_YDS) continue;
    holes.push({ hole: ref, par, line: line.map(p => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))] as [number, number]) });
  }
  if (greens.length < DERIVED_MIN_GREENS) return null;
  return { holes, source: 'osm', greens, derived: 'features' };
}

/** Where `p` projects on the chord a → b (t along it) and how far off it sits. */
function projectOnChord(a: [number, number], b: [number, number], p: [number, number]): { t: number; offsetM: number } {
  const kx = Math.cos((a[0] * Math.PI) / 180);
  const ax = 0, ay = 0;
  const bx = (b[1] - a[1]) * kx, by = b[0] - a[0];
  const px = (p[1] - a[1]) * kx, py = p[0] - a[0];
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (len2 === 0) return { t: 0, offsetM: Infinity };
  const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2;
  const fx = ax + t * (bx - ax), fy = ay + t * (by - ay);
  const degPerM = 1 / ((2 * Math.PI * 6371000) / 360);
  const offsetM = Math.sqrt((px - fx) ** 2 + (py - fy) ** 2) / degPerM;
  return { t, offsetM };
}
