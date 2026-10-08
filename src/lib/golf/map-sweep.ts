// ── The proactive course-map sweep — the pure half (map sweep PR 6, Oct 2026)
// Tom: "ensure we have all the courses possibly mapped as much as we can —
// not the lazy route." The lazy path fetches one course's OSM data on its
// first map open; this sweeps the WORLD by 0.5° cells — one regional
// Overpass answer per cell, then every course in the cell through THE SAME
// pipeline the lazy path runs (`resolveCourseTiers`), over the elements
// within 1,500 m of the course point, measured to the SEGMENT exactly as
// Overpass's `around` does. Resumable (migration 255's cells table), polite
// (one request in flight, gaps, backoff, mirror cooldowns, a daily cap),
// and never a stamped lie (an envelope guard, a partial guard, an
// empty-answer regression guard). Zero React, zero I/O here.

import { haversineKm } from '@/lib/golf/geocode';
import { isHoleWayElement, type HoleGeometry, type OverpassElement } from '@/lib/golf/hole-geometry';

export const CELL_SIZE_DEG = 0.5;
/** The query box grows by this (cos-scaled in longitude) so an element within
 *  COURSE_RADIUS_M of a course on the cell's edge has a vertex inside it. */
export const CELL_MARGIN_LAT_DEG = 0.03;
/** The lazy path's `around:1500`. */
export const COURSE_RADIUS_M = 1500;
/** A cell is re-swept two days BEFORE the lazy path's 30-day TTL lapses. */
export const CELL_TTL_MS = 28 * 24 * 60 * 60 * 1000;
export const OVERPASS_QUERY_TIMEOUT_S = 20;
export const REQUEST_TIMEOUT_MS = 22_000;
/** One invocation works this long (Vercel's 60 s minus headroom)… */
export const WORK_BUDGET_MS = 42_000;
/** …and starts a cell only while this much of it is left. */
export const CELL_START_RESERVE_MS = 30_000;
export const CELL_GAP_MS = 3_000;
export const COURSE_GAP_MS = 250;
export const LEASE_SECONDS = 120;
/** Consecutive transport failures → minutes until the next try (capped at the last). */
export const RETRY_DELAYS_MIN = [5, 15, 45, 120, 360];
export const MIRROR_COOLDOWN_MS = { 429: 15 * 60_000, other: 5 * 60_000 } as const;
/** Tom's courses first. */
export const OTTAWA_BOX = { south: 45.1, north: 45.6, west: -76.2, east: -75.3 };
export const TIER1 = ['CA'];
export const TIER2 = ['US', 'GB', 'IE', 'AU'];
/** More elements than this in one cell is logged — the cell wants splitting. */
export const CELL_ELEMENTS_WARN = 25_000;

const M_PER_DEG = (2 * Math.PI * 6371000) / 360;

// ── Cells ─────────────────────────────────────────────────────────────────────

/** `c05:<lat0>:<lng0>` — the SW corner at 0.5°, one decimal (`-0` prints `0.0`). */
export function cellKeyFor(lat: number, lng: number): string {
  const lat0 = Math.floor(lat / CELL_SIZE_DEG) * CELL_SIZE_DEG;
  const lng0 = Math.floor(lng / CELL_SIZE_DEG) * CELL_SIZE_DEG;
  return `c05:${(lat0 + 0).toFixed(1)}:${(lng0 + 0).toFixed(1)}`;
}

export interface CellBounds {
  lat0: number;
  lng0: number;
  lat1: number;
  lng1: number;
}

/** The box a key names, or null for a malformed key (the route answers 400). */
export function cellBounds(key: string): CellBounds | null {
  const m = /^c05:(-?\d+\.\d):(-?\d+\.\d)$/.exec(key);
  if (!m) return null;
  const lat0 = Number(m[1]);
  const lng0 = Number(m[2]);
  if (!Number.isFinite(lat0) || !Number.isFinite(lng0) || Math.abs(lat0) > 90 || Math.abs(lng0) > 180) return null;
  if (Math.abs((lat0 / CELL_SIZE_DEG) % 1) > 1e-9 || Math.abs((lng0 / CELL_SIZE_DEG) % 1) > 1e-9) return null;
  return { lat0, lng0, lat1: lat0 + CELL_SIZE_DEG, lng1: lng0 + CELL_SIZE_DEG };
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** The Overpass bbox for a cell: the box plus the margin. */
export function cellQueryBbox(key: string): Bbox | null {
  const b = cellBounds(key);
  if (!b) return null;
  const latMid = (b.lat0 + b.lat1) / 2;
  const dLng = CELL_MARGIN_LAT_DEG / Math.max(Math.cos((latMid * Math.PI) / 180), 0.1);
  return {
    south: Math.max(-90, b.lat0 - CELL_MARGIN_LAT_DEG),
    north: Math.min(90, b.lat1 + CELL_MARGIN_LAT_DEG),
    west: Math.max(-180, b.lng0 - dLng),
    east: Math.min(180, b.lng1 + dLng),
  };
}

/** The regional query: the five selectors of the lazy query over a bbox,
 *  `out geom` for lines / rings / boundaries, `out center` for the tee and
 *  fairway points. The 20 s in-band timeout lands inside the request's 22 s. */
export function overpassCellQuery(bbox: Bbox): string {
  const b = `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  return (
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}][maxsize:268435456];` +
    `(way["golf"="hole"]${b};way["golf"="green"]${b};relation["golf"="green"]${b};` +
    `way["leisure"="golf_course"]["name"]${b};relation["leisure"="golf_course"]["name"]${b};);out geom;` +
    `(node["golf"="tee"]${b};way["golf"="tee"]${b};way["golf"="fairway"]${b};);out center;`
  );
}

// ── Planning ──────────────────────────────────────────────────────────────────

export interface PlanCourse {
  id: string;
  lat: number | null;
  lng: number | null;
  country_code: string | null;
  external_source: string;
}

export interface PlannedCell {
  cell_key: string;
  lat0: number;
  lng0: number;
  size_deg: number;
  tier: 0 | 1 | 2 | 3;
  priority: number;
  courses: number;
  rounds: number;
}

const inOttawa = (lat: number, lng: number) =>
  lat >= OTTAWA_BOX.south && lat <= OTTAWA_BOX.north && lng >= OTTAWA_BOX.west && lng <= OTTAWA_BOX.east;

/** 0: Tom's box or any recorded round; 1: Canada; 2: the US / GB / IE / AU;
 *  3: everything else, no country code included. */
export function cellTier(courses: Array<{ lat: number; lng: number; country_code: string | null }>, rounds: number): 0 | 1 | 2 | 3 {
  if (rounds > 0 || courses.some(c => inOttawa(c.lat, c.lng))) return 0;
  if (courses.some(c => c.country_code && TIER1.includes(c.country_code))) return 1;
  if (courses.some(c => c.country_code && TIER2.includes(c.country_code))) return 2;
  return 3;
}

/** Lower first: the tier, then the busiest and biggest cells. */
export function cellPriority(tier: number, rounds: number, courses: number): number {
  return tier * 1_000_000 + (999_999 - Math.min(rounds, 999) * 1000 - Math.min(courses, 999));
}

/** The world's cells, from the catalog: every course with coordinates that
 *  is not a QA fixture, grouped by cell, tiered and prioritised. */
export function planCells(courses: PlanCourse[], roundsByCourse: Map<string, number> = new Map()): PlannedCell[] {
  const cells = new Map<string, { courses: Array<{ lat: number; lng: number; country_code: string | null }>; rounds: number }>();
  for (const c of courses) {
    if (c.external_source === 'qa-e2e') continue;
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const key = cellKeyFor(c.lat, c.lng);
    const cell = cells.get(key) ?? { courses: [], rounds: 0 };
    cell.courses.push({ lat: c.lat, lng: c.lng, country_code: c.country_code });
    cell.rounds += roundsByCourse.get(c.id) ?? 0;
    cells.set(key, cell);
  }
  const out: PlannedCell[] = [];
  for (const [cell_key, v] of cells) {
    const b = cellBounds(cell_key)!;
    const tier = cellTier(v.courses, v.rounds);
    out.push({ cell_key, lat0: b.lat0, lng0: b.lng0, size_deg: CELL_SIZE_DEG, tier, priority: cellPriority(tier, v.rounds, v.courses.length), courses: v.courses.length, rounds: v.rounds });
  }
  out.sort((a, b) => a.priority - b.priority || a.cell_key.localeCompare(b.cell_key));
  return out;
}

// ── The per-course filter (Overpass's `around` semantics) ────────────────────

type LatLng = [number, number];
type Pt = { lat: number; lon: number };
const validPt = (g: Pt | undefined) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon);

/** Every point chain an element is made of: a way's geometry, a relation's
 *  members' geometries, a node's point, a `center`. */
function chainsOf(el: OverpassElement): LatLng[][] {
  const e = el as OverpassElement & { lat?: number; lon?: number; center?: Pt };
  const chains: LatLng[][] = [];
  if (Array.isArray(el.geometry) && el.geometry.length) chains.push(el.geometry.filter(validPt).map(g => [g.lat, g.lon] as LatLng));
  if (Array.isArray(el.members)) {
    for (const m of el.members) if (Array.isArray(m?.geometry)) chains.push(m.geometry!.filter(validPt).map(g => [g.lat, g.lon] as LatLng));
  }
  if (!chains.length) {
    if (e.center && validPt(e.center)) chains.push([[e.center.lat, e.center.lon]]);
    else if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) chains.push([[e.lat!, e.lon!]]);
  }
  return chains;
}

/** Point → segment distance in metres, in a local equirectangular frame
 *  around the point (centimetre-accurate at course scale). */
function metresToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = M_PER_DEG * Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * M_PER_DEG;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * M_PER_DEG;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

/** The element's nearest approach to the point — its SEGMENTS, not only its
 *  vertices (Overpass's `around` matches a way whose edge passes within R). */
export function metresToElement(point: LatLng, el: OverpassElement): number {
  let best = Infinity;
  for (const chain of chainsOf(el)) {
    if (chain.length === 1) best = Math.min(best, haversineKm({ lat: point[0], lng: point[1] }, { lat: chain[0][0], lng: chain[0][1] }) * 1000);
    for (let i = 1; i < chain.length; i++) best = Math.min(best, metresToSegment(point, chain[i - 1], chain[i]));
  }
  return best;
}

/** A cheap box test before the segment maths. */
function nearBox(point: LatLng, el: OverpassElement, radiusM: number): boolean {
  const dLat = radiusM / M_PER_DEG;
  const dLng = radiusM / (M_PER_DEG * Math.max(Math.cos((point[0] * Math.PI) / 180), 0.1));
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const chain of chainsOf(el)) for (const [lat, lng] of chain) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  if (minLat === Infinity) return false;
  return point[0] >= minLat - dLat && point[0] <= maxLat + dLat && point[1] >= minLng - dLng && point[1] <= maxLng + dLng;
}

/** The regional elements within `radiusM` of a course point — the set the
 *  lazy `around:1500` query would have returned. */
export function elementsNear(elements: OverpassElement[], point: LatLng, radiusM: number = COURSE_RADIUS_M): OverpassElement[] {
  return elements.filter(el => nearBox(point, el, radiusM) && metresToElement(point, el) <= radiusM);
}

// ── Course outcomes and bookkeeping ───────────────────────────────────────────

/** The hole lines of two geometries, equal point for point (greens and
 *  sections aside) — a re-sweep that changes nothing re-attests the elevation. */
export function holesUnchanged(a: HoleGeometry | null, b: HoleGeometry | null): boolean {
  if (!a || !b) return a === b;
  if (a.holes.length !== b.holes.length) return false;
  return a.holes.every((h, i) => {
    const o = b.holes[i];
    return o.hole === h.hole && o.line.length === h.line.length && h.line.every((p, j) => p[0] === o.line[j][0] && p[1] === o.line[j][1]);
  });
}

export function retryDelayMs(attempts: number): number {
  const i = Math.max(0, Math.min(attempts, RETRY_DELAYS_MIN.length) - 1);
  return RETRY_DELAYS_MIN[i] * 60_000;
}

/** The mirror ladder minus the mirrors cooling down, the cooling ones last. */
export function pickMirror(mirrors: string[], cooldowns: Record<string, string | number>, now: number): string[] {
  const ready: string[] = [];
  const cooling: string[] = [];
  for (const m of mirrors) {
    const until = cooldowns[m];
    const t = typeof until === 'number' ? until : until ? Date.parse(until) : NaN;
    if (Number.isFinite(t) && t > now) cooling.push(m);
    else ready.push(m);
  }
  return [...ready, ...cooling];
}

export const hasHoleWays = (elements: OverpassElement[]) => elements.some(isHoleWayElement);

export interface CellMetrics {
  courses: number;
  attempted: number;
  mapped: number;
  with_greens: number;
  sections: number;
  derived: number;
  greens_only: number;
  null_no_coverage: number;
  refused: Partial<Record<'unlabeled' | 'duplicate_refs' | 'short' | 'boundary', number>>;
  elements: number;
}

export const emptyMetrics = (courses: number, elements: number): CellMetrics => ({
  courses, attempted: 0, mapped: 0, with_greens: 0, sections: 0, derived: 0, greens_only: 0, null_no_coverage: 0, refused: {}, elements,
});

export type CellOutcome = 'done' | 'transport' | 'released' | 'skipped_budget' | 'dry_run';

export interface SweepBatchSummary {
  phase: 'plan' | 'geometry' | 'elevation' | 'hydration';
  dryRun: boolean;
  cells: Array<{ cell_key: string; outcome: CellOutcome; metrics?: CellMetrics; error?: string; mirror?: string; ms?: number }>;
  remaining: number;
  budgetExhausted: boolean;
  elapsedMs: number;
}
