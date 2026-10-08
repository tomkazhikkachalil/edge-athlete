// ── Per-hole course geometry (OSM Overpass) ──────────────────────────────────
// "Why do other golf apps bring you hole by hole?" — they license mapped
// course data. Our free source is OpenStreetMap's golf mapping: `golf=hole`
// ways are tee→green polylines tagged with the hole number (`ref`) and par.
// Coverage is real but uneven — verified live: Rideau View and Eagle Creek
// carry clean refs 1–18; Ottawa Hunt (a 27-hole club) has refs 1–9 twice
// with no course relations to disambiguate, so it VALIDATES TO NOTHING and
// the map falls back to course-level behavior. Never partial-trust
// ambiguous data — a wrong hole overlay is worse than none.
//
// Multi-course facilities and neighbor overlaps (The Marshes' academy nine,
// Royal Ottawa's three adjacent Gatineau clubs, Pebble Beach's neighbor) put
// several courses' refs inside the 1500 m radius. OSM also carries the
// disambiguator: named `leisure=golf_course` boundary polygons. When the
// plain parse rejects the set, `scopeHoleGeometry` picks the boundary whose
// name matches the catalog course and keeps only holes inside it, then
// re-applies the SAME strict rules. Point-containment alone is not enough —
// The Marshes' catalog point sits inside the sibling Marchwood polygon
// (probed live), which is why the match is by NAME, never by which polygon
// contains the course point. Clubs whose own boundary holds duplicate refs
// (Ottawa Hunt's three nines, Royal Ottawa's 18 + West Nine) still null.
//
// Overpass etiquette: server-side only, descriptive UA, one fetch per course
// per 30 days (cached in golf_courses.hole_geometry / hole_geometry_at,
// migration 102), budgeted via the provider budget like everything else.
// The public servers shed load with 504s routinely (observed while building
// this) — hence the mirror ladder and the always-safe null.

import type { SupabaseClient } from '@supabase/supabase-js';
import { haversineKm } from '@/lib/golf/geocode';
import { pointInRing, ringCentroid, YDS_PER_KM, type Ring } from '@/lib/golf/green';

export interface HoleLine {
  hole: number;
  par: number | null;
  /** Tee→green polyline, [lat,lng] pairs, 6dp. line[0] is the tee,
   *  line[line.length-1] the green (OSM drawing convention). */
  line: [number, number][];
  /** The green's outline when the cache holds one (PR G3) — a RUNTIME
   *  convenience the live page attaches from `HoleGeometry.greens` so one
   *  object carries a hole to the map and the scorer. Never stored here:
   *  the stored shape keeps `greens` beside `holes`. */
  green?: Ring;
}

/** A green's outline (PR G2, Oct 2026). `hole` is null for an UNNUMBERED
 *  ring — the greens-only tier (sweep PR 3): a course whose greens are drawn
 *  but carry no hole number keeps them for the nearest-green rangefinder. */
export interface GreenRing {
  hole: number | null;
  /** Closed [lat,lng] ring, 6dp. */
  ring: Ring;
}

/** One of a club's unlabelled clean loops (sweep PR 4): a pickable nine. */
export interface HoleSection {
  label: string;
  holes: HoleLine[];
  greens?: GreenRing[];
}

export interface HoleGeometry {
  /** May be EMPTY when `greens` (greens-only) or `sections` carry the course. */
  holes: HoleLine[];
  source: 'osm';
  /** The `golf=green` outlines assigned to holes (by the line END). ABSENT
   *  on a geometry cached before PR G2 — the cache layer refetches such a
   *  row once; PRESENT and empty when OSM has no outlines here (the stamp). */
  greens?: GreenRing[];
  /** Pickable loops when the club's nines carry no labels (≥ 2 entries). */
  sections?: HoleSection[];
  /** Lines synthesised from numbered tees / fairways / greens (PR 5). */
  derived?: 'features';
}

interface OverpassMember {
  type?: string;
  role?: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OverpassElement {
  type?: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: OverpassMember[];
}

/** Parse + validate an Overpass `out geom` response into hole geometry.
 *  Null when the data can't be trusted: refs missing/non-numeric on any way,
 *  DUPLICATE refs (multi-course facility — ambiguous), or fewer than 9
 *  holes. Exported pure for tests. */
export function parseHoleGeometry(payload: unknown): HoleGeometry | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const holes: HoleLine[] = [];
  const seen = new Set<number>();
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (tags.golf !== 'hole') continue;
    const ref = tags.ref ?? '';
    if (!/^\d+$/.test(ref)) return null; // unlabeled hole way — can't trust the set
    const hole = Number(ref);
    if (seen.has(hole)) return null; // duplicate refs = ambiguous facility
    const line = (el.geometry ?? [])
      .filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
      .map(g => [Number(g.lat.toFixed(6)), Number(g.lon.toFixed(6))] as [number, number]);
    if (line.length < 2) return null; // a hole without a usable line
    seen.add(hole);
    const par = /^\d+$/.test(tags.par ?? '') ? Number(tags.par) : null;
    holes.push({ hole, par, line });
  }
  if (holes.length < 9) return null;
  holes.sort((a, b) => a.hole - b.hole);
  return { holes, source: 'osm' };
}

// ── Boundary scoping for multi-course facilities ─────────────────────────────

// `Ring` ([lat,lng] vertices; first === last when closed) lives in green.ts.

/** Words that appear in nearly every course name and therefore can't tell two
 *  neighboring clubs apart. Everything else counts toward a name match. */
const GENERIC_NAME_TOKENS = new Set([
  'golf', 'club', 'course', 'country', 'the', 'and', 'at', 'links', 'gc', 'cc',
  'de', 'du', 'des', 'le', 'la', 'les',
]);

/** Informative tokens of a course name. Unicode-aware: the split was
 *  `[^a-z0-9]`, which turned every CJK/Cyrillic/Thai name into \u2205 (never
 *  scopable \u2014 the catalog is worldwide now) and shredded non-decomposing
 *  Latin letters ("S\u00f8ller\u00f8d" \u2192 s, ller, d). Same splitter as
 *  src/lib/search/people.ts. Single LETTERS are dropped \u2014 the possessive
 *  in "King's" scored a match against "Queen's" \u2014 but single digits stay:
 *  "Pinehurst No. 2" and "No. 8" are different courses. */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(t => t && !GENERIC_NAME_TOKENS.has(t) && !/^\p{L}$/u.test(t))
  );
}

/** Shared informative tokens between a catalog course name and an OSM boundary
 *  name. 0 = no match ("The Marshes" vs "The Marchwood"); generic-only names
 *  can never match anything. Exported pure for tests. */
export function courseNameScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  let score = 0;
  for (const t of ta) if (tb.has(t)) score += 1;
  return score;
}

const samePoint = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;

/** Chain relation member ways (unordered, arbitrary direction) into closed
 *  rings. Pieces that never close are dropped — an unclosed boundary can't
 *  answer point-in-polygon. */
function assembleRings(pieces: Ring[]): Ring[] {
  const remaining = pieces.filter(p => p.length >= 2).map(p => [...p]);
  const rings: Ring[] = [];
  while (remaining.length) {
    let ring = remaining.shift()!;
    let extended = true;
    while (extended && !samePoint(ring[0], ring[ring.length - 1])) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const head = ring[0];
        const tail = ring[ring.length - 1];
        if (samePoint(tail, seg[0])) ring = ring.concat(seg.slice(1));
        else if (samePoint(tail, seg[seg.length - 1])) ring = ring.concat([...seg].reverse().slice(1));
        else if (samePoint(head, seg[seg.length - 1])) ring = seg.slice(0, -1).concat(ring);
        else if (samePoint(head, seg[0])) ring = [...seg].reverse().slice(0, -1).concat(ring);
        else continue;
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

// pointInRing: see green.ts (moved there in PR G1 so green.ts stays a leaf).

const validPt = (g: { lat: number; lon: number } | undefined) =>
  Number.isFinite(g?.lat) && Number.isFinite(g?.lon);

/** Order-independent identity of a boundary's rings: vertex count plus the
 *  first and middle vertices of each ring. Enough to recognise the same
 *  polygon delivered twice (way + relation); not a geometric equality. */
function ringSignature(rings: Ring[]): string {
  return rings
    .map(r => `${r.length}:${r[0]?.join(',')}:${r[Math.floor(r.length / 2)]?.join(',')}`)
    .sort()
    .join('|');
}

/** Overpass reports query timeouts and memory aborts IN-BAND once output has
 *  begun: HTTP 200, well-formed JSON, truncated `elements`, plus a `remark`.
 *  With two `out geom;` statements the hole ways have often already flushed
 *  when the heavier boundary statement dies — a 200 that parses as "holes
 *  but no boundaries", which the cache then stamped as 30 days of no
 *  coverage. Treat it as a transport failure. Exported pure for tests. */
export function isOverpassPartial(payload: unknown): boolean {
  const remark = (payload as { remark?: unknown } | null)?.remark;
  return typeof remark === 'string' && /runtime error|timed out|out of memory/i.test(remark);
}

/** Strict name identity between a catalog course and an OSM boundary: every
 *  informative token of the SHORTER name must appear in the other ("Kanata
 *  Golf Club" ⊂ "Kanata Golf Club"; "The Marshes Golf Club" vs "The
 *  Marchwood" = no). A single shared token ("Ottawa Hunt" vs "Ottawa Valley")
 *  is not identity — the review's neighbour-boundary finding. */
function boundaryNameMatches(courseName: string, boundaryName: string): boolean {
  const a = nameTokens(courseName);
  const b = nameTokens(boundaryName);
  const shared = [...a].filter(t => b.has(t)).length;
  if (shared === 0) return false;
  const shorter = Math.min(a.size, b.size);
  if (shared < shorter) return false;
  // A ONE-token identity is only identity when that token LEADS the longer
  // name: "Ottawa Golf Course" is not "Royal Ottawa Golf Club" (the first
  // informative token is "royal"), but "Kanata Golf Club" is "Kanata".
  // Neighbouring clubs are 300–500 m apart, so distance can't tell them
  // apart — the name has to.
  if (shorter === 1) {
    const [first] = a.size >= b.size ? a : b;
    const [only] = a.size >= b.size ? b : a;
    return first === only;
  }
  return true;
}

/** Metres from a point to the nearest vertex of a ring (good enough at
 *  course scale — rings are dense polygons, not two-point chords). */
function metresToRing(pt: [number, number], ring: Ring): number {
  let best = Infinity;
  for (const v of ring) {
    const km = haversineKm({ lat: pt[0], lng: pt[1] }, { lat: v[0], lng: v[1] });
    if (km < best) best = km;
  }
  return best * 1000;
}

// Coarse sanity only: a ring that merely grazes the 1.5 km fetch radius is
// not this club. It cannot separate ADJACENT clubs (their rings are 300–500 m
// from a course point, measured on the Royal Ottawa/Champlain and Marshes/
// Marchwood fixtures) — boundaryNameMatches does that.
const BOUNDARY_PROXIMITY_M = 1000;

interface Boundary {
  rings: Ring[];
  score: number;
}

/** The ONE boundary that is this course, or null (none / ambiguous). Rules:
 *  strict name identity (boundaryNameMatches); when the course point is
 *  known, the ring must contain it or pass within 1 km (a coarse guard —
 *  see BOUNDARY_PROXIMITY_M); identical geometry
 *  delivered twice (way + relation) collapses; two DIFFERENT polygons with
 *  equal score are an ambiguity and give up. */
/** The rings of a named `leisure=golf_course` element (a closed way, or a
 *  multipolygon relation's outer members chained into rings). */
function boundaryRings(el: OverpassElement): Ring[] {
  if (el.type === 'way' && Array.isArray(el.geometry)) {
    return assembleRings([el.geometry.filter(validPt).map(g => [g.lat, g.lon] as [number, number])]);
  }
  if (el.type === 'relation' && Array.isArray(el.members)) {
    return assembleRings(
      el.members
        .filter(m => m?.type === 'way' && (!m.role || m.role === 'outer') && Array.isArray(m.geometry))
        .map(m => m.geometry!.filter(validPt).map(g => [g.lat, g.lon] as [number, number]))
    );
  }
  return [];
}

/** A named course polygon in the payload, and whether its name IS this
 *  course's (`boundaryNameMatches`). The claims model (sweep PR 2, Oct 2026)
 *  reads EVERY named boundary, not only the matching one: a neighbour's
 *  polygon is what tells a neighbour's holes apart. */
export interface NamedBoundary {
  name: string;
  rings: Ring[];
  matches: boolean;
  score: number;
}

/** Every named `leisure=golf_course` polygon in the payload with usable
 *  rings, identical geometry delivered twice (way + relation) collapsed.
 *  Exported pure for tests. */
export function namedBoundaries(elements: OverpassElement[], courseName: string): NamedBoundary[] {
  const out: NamedBoundary[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (tags.leisure !== 'golf_course' || !tags.name) continue;
    const rings = boundaryRings(el);
    if (!rings.length) continue;
    const sig = ringSignature(rings);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({
      name: tags.name,
      rings,
      matches: boundaryNameMatches(courseName, tags.name),
      score: courseNameScore(courseName, tags.name),
    });
  }
  return out;
}

/** The vertices an element is judged by: a way's geometry, a node's point,
 *  a relation's members' geometry. */
function elementPoints(el: OverpassElement): [number, number][] {
  const e = el as OverpassElement & { lat?: number; lon?: number; center?: { lat: number; lon: number } };
  if (Array.isArray(el.geometry) && el.geometry.length) return el.geometry.filter(validPt).map(g => [g.lat, g.lon]);
  if (el.type === 'relation' && Array.isArray(el.members)) {
    return el.members.flatMap(m => (Array.isArray(m?.geometry) ? m.geometry!.filter(validPt).map(g => [g.lat, g.lon] as [number, number]) : []));
  }
  if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) return [[e.lat!, e.lon!]];
  if (e.center && Number.isFinite(e.center.lat) && Number.isFinite(e.center.lon)) return [[e.center.lat, e.center.lon]];
  return [];
}

const insideRings = (pt: [number, number], rings: Ring[]) => rings.some(r => pointInRing(pt, r));

/** The boundaries that CLAIM an element: those holding the MAJORITY of its
 *  vertices (majority, not the single midpoint vertex — on a 2-node way
 *  that was the green, and a perimeter hole near a hand-drawn polygon
 *  vanished without a trace). Nested polygons may both claim one way.
 *  Exported pure for tests. */
export function claimsFor(el: OverpassElement, boundaries: NamedBoundary[]): NamedBoundary[] {
  const pts = elementPoints(el);
  if (!pts.length) return [];
  return boundaries.filter(b => pts.filter(p => insideRings(p, b.rings)).length * 2 >= pts.length);
}

/** The ONE boundary that is this course, or null (none / ambiguous). Rules:
 *  strict name identity (boundaryNameMatches); when the course point is
 *  known, the ring must contain it or pass within 1 km (a coarse guard —
 *  see BOUNDARY_PROXIMITY_M); identical geometry delivered twice (way +
 *  relation) collapses; two DIFFERENT polygons with equal score are an
 *  ambiguity and give up. */
function pickBoundary(
  elements: OverpassElement[],
  courseName: string,
  point: [number, number] | null | undefined
): Boundary | null {
  const boundaries = namedBoundaries(elements, courseName).filter(b => {
    if (!b.matches) return false;
    if (!point) return true;
    return b.rings.some(r => pointInRing(point, r) || metresToRing(point, r) <= BOUNDARY_PROXIMITY_M);
  });
  if (!boundaries.length) return null;
  const distinct = [...boundaries].sort((a, b) => b.score - a.score);
  if (distinct.length > 1 && distinct[0].score === distinct[1].score) return null;
  return { rings: distinct[0].rings, score: distinct[0].score };
}

const isHoleWay = (el: OverpassElement) => el?.tags?.golf === 'hole';

/** How far from its own polygon's ring a way may sit and still be this
 *  course's — hand-drawn boundaries routinely clip a perimeter hole. */
export const BOUNDARY_NEAR_M = 150;
/** An UNCLAIMED set (a course with no polygon of its own beside clubs that
 *  have one) is accepted only when its tees sit this close to the course point. */
export const UNCLAIMED_MAX_M = 800;

export type ScopeMode = 'own' | 'near' | 'unclaimed' | 'all';

export interface ScopedWays {
  ways: OverpassElement[];
  boundary: Boundary | null;
  mode: ScopeMode;
}

/** THE scoping decision every later stage runs on (the strict parse, the
 *  section split, the loop clustering, the feature derivation) — the claims
 *  model (sweep PR 2, Oct 2026). A boundary's job is to EXCLUDE a
 *  neighbour's holes, never to veto its own course's:
 *   1. B = pickBoundary (strict name identity, the 1 km guard, a tie → null).
 *   2. With B — `own`: the ways whose majority sits inside B; a valid strict
 *      parse of them is the answer (Marshes 18, Champlain 18 — unchanged).
 *   3. Own empty or invalid — `near`: own ∪ the ways claimed by NO other
 *      named polygon that touch B (any vertex inside, or the nearest within
 *      BOUNDARY_NEAR_M). A way another club's polygon owns is NEVER this
 *      course's, however close (Marchwood stays null; Glen Mar's nine sit in
 *      Canadian's polygon — honest null; a sloppy own polygon no longer vetoes).
 *   4. No B but other named polygons exist — `unclaimed`: the ways no polygon
 *      claims (the caller adds the UNCLAIMED_MAX_M guard). The old no-boundary
 *      path parsed EVERYTHING, so a boundary-less course beside a clean
 *      neighbour inherited its 18 — closed here.
 *   5. No named polygons at all — `all` (Rideau View, unchanged).
 *  Exported pure for tests. */
export function scopeHoleWays(
  elements: OverpassElement[],
  courseName: string | null | undefined,
  point: [number, number] | null | undefined,
  select: (el: OverpassElement) => boolean = isHoleWay,
  /** "The own set is already the answer" — the strict parse for hole ways;
   *  a count for rings or features. */
  valid: (own: OverpassElement[]) => boolean = own => parseHoleGeometry({ elements: own }) !== null
): ScopedWays {
  const name = (courseName ?? '').trim();
  const candidates = elements.filter(select);
  const boundaries = name ? namedBoundaries(elements, name) : [];
  if (!boundaries.length) return { ways: candidates, boundary: null, mode: 'all' };
  const B = name ? pickBoundary(elements, name, point) : null;
  if (!B) {
    const unclaimed = candidates.filter(el => claimsFor(el, boundaries).length === 0);
    return { ways: unclaimed, boundary: null, mode: 'unclaimed' };
  }
  const own = candidates.filter(el => {
    const pts = elementPoints(el);
    return pts.length > 0 && pts.filter(p => insideRings(p, B.rings)).length * 2 >= pts.length;
  });
  if (valid(own)) return { ways: own, boundary: B, mode: 'own' };
  const others = boundaries.filter(b => !b.matches);
  const ownSet = new Set(own);
  const near = candidates.filter(el => {
    if (ownSet.has(el)) return true;
    if (claimsFor(el, others).length > 0) return false;
    const pts = elementPoints(el);
    if (!pts.length) return false;
    if (pts.some(p => insideRings(p, B.rings))) return true;
    return pts.some(p => B.rings.some(r => metresToRing(p, r) <= BOUNDARY_NEAR_M));
  });
  return { ways: near, boundary: B, mode: 'near' };
}

/** The payload a later stage sees: the scoped hole ways beside every
 *  non-hole element (boundaries, greens, features) of the original. */
export function scopedPayload(elements: OverpassElement[], scoped: ScopedWays): { elements: OverpassElement[] } {
  const keep = new Set(scoped.ways);
  return { elements: elements.filter(el => !isHoleWay(el) || keep.has(el)) };
}

/** The mean of the holes' tees, in metres from the course point. */
function teeCentroidMetres(g: HoleGeometry, point: [number, number]): number {
  const tees = g.holes.map(h => h.line[0]);
  const lat = tees.reduce((s, t) => s + t[0], 0) / tees.length;
  const lng = tees.reduce((s, t) => s + t[1], 0) / tees.length;
  return haversineKm({ lat, lng }, { lat: point[0], lng: point[1] }) * 1000;
}

/** Scope a payload to the boundary that IS this course (see pickBoundary)
 *  and re-apply the strict parse. Null when no boundary matches, when two
 *  tie, or when the scoped set is itself invalid (duplicate refs inside one
 *  club, fewer than 9 holes). Exported pure for tests. */
export function scopeHoleGeometry(
  payload: unknown,
  courseName: string,
  point?: [number, number] | null
): HoleGeometry | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements) || !courseName.trim()) return null;
  const scoped = scopeHoleWays(elements, courseName, point);
  return scoped.boundary ? parseHoleGeometry({ elements: scoped.ways }) : null;
}

/** The whole decision for one Overpass payload — the strict parse over the
 *  claims-scoped ways (scopeHoleWays), plus the UNCLAIMED guard: a set no
 *  polygon owns is this course's only when its tees sit within
 *  UNCLAIMED_MAX_M of the course point. Exported pure for tests. */
export function resolveHoleGeometry(
  payload: unknown,
  courseName: string | null | undefined,
  point?: [number, number] | null
): HoleGeometry | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const scoped = scopeHoleWays(elements, courseName, point);
  const g = parseHoleGeometry({ elements: scoped.ways });
  if (!g) return null;
  if (scoped.mode === 'unclaimed' && point && teeCentroidMetres(g, point) > UNCLAIMED_MAX_M) return null;
  return g;
}

// ── Green outlines (PR G2, Oct 2026) ─────────────────────────────────────────
// OSM maps greens as closed `golf=green` ways (rarely relations), almost
// never with a `ref`. The assignment is geometric: the ring that CONTAINS a
// hole line's end owns that hole; failing that, the nearest ring within
// GREEN_ASSIGN_M of the end (hand-drawn lines stop short of the green all the
// time). One ring may serve two holes — a double green is real. A hole with
// no ring simply has no green outline, and `greenDistances` is never faked.

/** How far past the line's end a green may sit and still be that hole's. */
export const GREEN_ASSIGN_M = 40;

const toRing = (geom: { lat: number; lon: number }[] | undefined): Ring =>
  (geom ?? []).filter(validPt).map(g => [Number(g.lat.toFixed(6)), Number(g.lon.toFixed(6))] as [number, number]);

/** Every closed `golf=green` ring in an Overpass payload. Exported pure for
 *  tests. */
export function parseGreenRings(payload: unknown): Ring[] {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const rings: Ring[] = [];
  for (const el of elements) {
    if (el?.tags?.golf !== 'green') continue;
    let found: Ring[] = [];
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      found = assembleRings([toRing(el.geometry)]);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      found = assembleRings(
        el.members
          .filter(m => m?.type === 'way' && (!m.role || m.role === 'outer') && Array.isArray(m.geometry))
          .map(m => toRing(m.geometry))
      );
    }
    for (const r of found) if (r.length >= 4) rings.push(r);
  }
  return rings;
}

/** Assign rings to holes by the line END: containment first, else the
 *  nearest ring within GREEN_ASSIGN_M. Holes with nothing are absent; a ring
 *  may appear under two holes. Exported pure for tests. */
export function assignGreens(holes: HoleLine[], rings: Ring[]): GreenRing[] {
  const out: GreenRing[] = [];
  if (!rings.length) return out;
  for (const h of holes) {
    const end = h.line[h.line.length - 1];
    if (!end) continue;
    const containing = rings.filter(r => pointInRing(end, r));
    let pick: Ring | null = null;
    if (containing.length === 1) {
      pick = containing[0];
    } else if (containing.length > 1) {
      let best = Infinity;
      for (const r of containing) {
        const c = ringCentroid(r);
        const d = c ? metresToRing(end, [c]) : Infinity;
        if (d < best) { best = d; pick = r; }
      }
    } else {
      let best = GREEN_ASSIGN_M;
      for (const r of rings) {
        const d = metresToRing(end, r);
        if (d <= best) { best = d; pick = r; }
      }
    }
    if (pick) out.push({ hole: h.hole, ring: pick });
  }
  return out;
}

/** The geometry with its greens ALWAYS set — `[]` when the payload holds no
 *  outlines, which is the stamp that stops the cache layer refetching. */
export function withGreens(geometry: HoleGeometry, payload: unknown): HoleGeometry {
  const rings = parseGreenRings(payload);
  const out: HoleGeometry = { ...geometry, greens: assignGreens(geometry.holes, rings) };
  if (geometry.sections) out.sections = geometry.sections.map(s => ({ ...s, greens: assignGreens(s.holes, rings) }));
  return out;
}

/** The greens-only tier (sweep PR 3) needs this many rings of its own. */
export const GREENS_ONLY_MIN = 9;
const isGreenEl = (el: OverpassElement) => el?.tags?.golf === 'green';

/** Tier 5 — the course has no usable hole lines but OSM has drawn its
 *  greens: keep the rings this course owns (the claims scope, with "≥ 9
 *  rings" as the own-set test) as UNNUMBERED greens — the rangefinder reads
 *  the nearest one. Never a line, never a hole number. Null under
 *  GREENS_ONLY_MIN. Exported pure for tests. */
export function greensOnlyGeometry(
  payload: unknown,
  courseName: string | null | undefined,
  point?: [number, number] | null
): HoleGeometry | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const scoped = scopeHoleWays(elements, courseName, point, isGreenEl, own => own.length >= GREENS_ONLY_MIN);
  if (scoped.mode === 'unclaimed' && point) {
    // A boundary-less course beside clubs that have polygons: the same
    // 800 m rule as the lines — every ring must sit near the course point.
    const rings = parseGreenRings({ elements: scoped.ways });
    const near = rings.filter(r => { const c = ringCentroid(r); return !!c && haversineKm({ lat: c[0], lng: c[1] }, { lat: point[0], lng: point[1] }) * 1000 <= UNCLAIMED_MAX_M; });
    if (near.length < GREENS_ONLY_MIN) return null;
    return { holes: [], source: 'osm', greens: near.map(ring => ({ hole: null, ring })) };
  }
  const rings = parseGreenRings({ elements: scoped.ways });
  if (rings.length < GREENS_ONLY_MIN) return null;
  return { holes: [], source: 'osm', greens: rings.map(ring => ({ hole: null, ring })) };
}

// ── Multi-course clubs (migration 125): cluster-splitting + combos ──────────
// A club whose one boundary holds DUPLICATE refs (Ottawa Hunt: 1–9 twice) is
// exactly the case parseHoleGeometry refuses. The refs still encode K clean
// loops; what's missing is which way belongs to which loop, and which loop is
// which SECTION. clusterHoleLoops recovers the loops geometrically (a nine
// chains green → next tee at walking distance); assignClustersToSections
// labels them ONLY on positive OSM evidence (a section-named sub-boundary or
// section-named hole ways). No evidence → null, never a guess — a wrong hole
// overlay is worse than none, and the 30-day retry picks up OSM improvements.

/** A hole way with its optional OSM name tag (evidence for section labeling). */
export interface NamedHoleLine extends HoleLine {
  name?: string;
}

/** parseHoleGeometry's trust rules MINUS the duplicate-ref rejection — the
 *  input to clustering. Null on unlabeled ways or unusable lines (the set
 *  still can't be trusted then). Exported pure for tests. */
export function parseHoleWaysLenient(payload: unknown): NamedHoleLine[] | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const holes: NamedHoleLine[] = [];
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (tags.golf !== 'hole') continue;
    const ref = tags.ref ?? '';
    if (!/^\d+$/.test(ref)) return null;
    const line = (el.geometry ?? [])
      .filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon))
      .map(g => [Number(g.lat.toFixed(6)), Number(g.lon.toFixed(6))] as [number, number]);
    if (line.length < 2) return null;
    const par = /^\d+$/.test(tags.par ?? '') ? Number(tags.par) : null;
    holes.push({ hole: Number(ref), par, line, ...(tags.name ? { name: tags.name } : {}) });
  }
  return holes.length ? holes : null;
}

/** Walking distance green → next tee within one loop. Measured expectation is
 *  well under 300 m on real courses; anything past it means the chain jumped
 *  to another loop — give up rather than guess. */
const MAX_GREEN_TO_TEE_M = 300;
/** A chosen assignment must beat every rival loop by this factor (or be
 *  near-touching) — near-ties are ambiguity, not evidence. */
const ASSIGNMENT_DOMINANCE = 0.8;
const NEAR_TOUCH_M = 30;

const metresBetween = (a: [number, number], b: [number, number]) =>
  haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;

/** Split duplicate-ref hole ways into coherent loops, or null when the
 *  geometry is ambiguous. The refs must run 1..max without a gap and their
 *  MULTIPLICITY must never increase along the run (sweep PR 4: an 18 and a
 *  nine on one club are refs 1–9 ×2 and 10–18 ×1 — the old "every ref
 *  exactly K times" rule refused Royal Ottawa's own 27); K = the count at
 *  ref 1, ≥ 2. Loops grow by nearest green→tee chaining with a global
 *  non-conflicting assignment per ref; a loop that finds no candidate at
 *  ref r CLOSES at r−1, which must be a multiple of nine, and never
 *  reopens; every final loop is a 9 or an 18. Null on any over-distance
 *  link or near-tie. Exported pure for tests. */
export function clusterHoleLoops(ways: NamedHoleLine[]): NamedHoleLine[][] | null {
  const byRef = new Map<number, NamedHoleLine[]>();
  for (const w of ways) {
    const arr = byRef.get(w.hole) ?? [];
    arr.push(w);
    byRef.set(w.hole, arr);
  }
  const refs = [...byRef.keys()].sort((a, b) => a - b);
  if (refs.length < 9) return null;
  if (refs[0] !== 1 || refs.some((r, i) => r !== i + 1)) return null; // contiguous from 1
  const k = byRef.get(1)!.length;
  if (k < 2) return null;
  for (let i = 1; i < refs.length; i++) {
    if (byRef.get(refs[i])!.length > byRef.get(refs[i - 1])!.length) return null; // never increasing
  }

  // Seed K loops from ref 1's ways.
  const loops: NamedHoleLine[][] = byRef.get(1)!.map(w => [w]);
  const closed = new Set<number>();

  for (const ref of refs.slice(1)) {
    const candidates = byRef.get(ref)!;
    const open = loops.map((_, li) => li).filter(li => !closed.has(li));
    if (candidates.length > open.length) return null;
    // Distance from each open loop's current green to each candidate's tee.
    const dist = new Map<number, number[]>();
    for (const li of open) {
      const loop = loops[li];
      const green = loop[loop.length - 1].line[loop[loop.length - 1].line.length - 1];
      dist.set(li, candidates.map(c => metresBetween(green, c.line[0])));
    }
    // Global greedy: accept the smallest non-conflicting pairs.
    const pairs: Array<{ li: number; ci: number; d: number }> = [];
    for (const li of open) for (let ci = 0; ci < candidates.length; ci++) pairs.push({ li, ci, d: dist.get(li)![ci] });
    pairs.sort((a, b) => a.d - b.d);
    const loopTaken = new Set<number>();
    const candTaken = new Set<number>();
    const chosen: Array<{ li: number; ci: number; d: number }> = [];
    for (const p of pairs) {
      if (loopTaken.has(p.li) || candTaken.has(p.ci)) continue;
      loopTaken.add(p.li);
      candTaken.add(p.ci);
      chosen.push(p);
    }
    for (const p of chosen) {
      // Over-distance: the chain broke — this is not one loop's next hole.
      if (p.d > MAX_GREEN_TO_TEE_M) return null;
      // Dominance: the way must clearly belong to ITS loop, not almost-
      // equally to another (near-touching links are exempt — nines that
      // share a clubhouse green/tee cluster can sit close).
      if (p.d > NEAR_TOUCH_M) {
        for (const li of open) {
          if (li === p.li) continue;
          if (p.d > dist.get(li)![p.ci] * ASSIGNMENT_DOMINANCE) return null;
        }
      }
      loops[p.li].push(candidates[p.ci]);
    }
    // The open loops that found nothing close here, at a full nine or 18.
    for (const li of open) {
      if (loopTaken.has(li)) continue;
      if (loops[li].length % 9 !== 0) return null;
      closed.add(li);
    }
  }

  // Each loop must be a clean nine or eighteen.
  if (loops.some(l => l.length !== 9 && l.length !== 18)) return null;
  return loops.map(l => l.slice().sort((a, b) => a.hole - b.hole));
}

/** Tokens of a SECTION discriminator ("Premier", "North Nine"). */
function sectionTokens(sectionName: string | null | undefined): Set<string> {
  if (!sectionName) return new Set();
  return new Set(
    sectionName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(t => t && !GENERIC_NAME_TOKENS.has(t))
  );
}

interface SectionRowLite {
  id: string;
  name: string;
  section_name?: string | null;
}

/** Bind split loops to section rows on POSITIVE evidence only: a boundary
 *  whose name carries the section's discriminator and contains the loop's
 *  majority of vertices, or hole-way name tags carrying it. Every loop must
 *  bind to a DISTINCT section or the whole answer is null. Exported pure for
 *  tests. */
export function assignClustersToSections(
  clusters: NamedHoleLine[][],
  sections: SectionRowLite[],
  payload: unknown
): Map<string, HoleGeometry> | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements ?? [];
  const out = new Map<string, HoleGeometry>();
  const usedSections = new Set<string>();
  for (const cluster of clusters) {
    let matchId: string | null = null;
    for (const section of sections) {
      const disc = sectionTokens(section.section_name);
      if (!disc.size) continue;
      // Evidence 1: a sub-boundary named for THIS section containing the
      // cluster's majority of vertices.
      let boundaryHit = false;
      for (const el of elements) {
        const tags = el?.tags ?? {};
        if (tags.leisure !== 'golf_course' || !tags.name) continue;
        const bTokens = sectionTokens(tags.name);
        if (![...disc].every(t => bTokens.has(t))) continue;
        const rings =
          el.type === 'way' && Array.isArray(el.geometry)
            ? assembleRings([el.geometry.filter(validPt).map(g => [g.lat, g.lon] as [number, number])])
            : el.type === 'relation' && Array.isArray(el.members)
              ? assembleRings(
                  el.members
                    .filter(m => m?.type === 'way' && (!m.role || m.role === 'outer') && Array.isArray(m.geometry))
                    .map(m => m.geometry!.filter(validPt).map(g => [g.lat, g.lon] as [number, number]))
                )
              : [];
        if (!rings.length) continue;
        const pts = cluster.flatMap(w => w.line);
        const inside = pts.filter(pt => rings.some(r => pointInRing(pt, r))).length;
        if (inside * 2 >= pts.length) {
          boundaryHit = true;
          break;
        }
      }
      // Evidence 2: hole-way name tags carrying the discriminator on the
      // cluster's majority of ways.
      const named = cluster.filter(w => {
        const wTokens = sectionTokens(w.name);
        return [...disc].every(t => wTokens.has(t));
      }).length;
      const nameHit = named * 2 >= cluster.length && named > 0;
      if (boundaryHit || nameHit) {
        if (matchId) return null; // two sections claim one loop — ambiguous
        matchId = section.id;
      }
    }
    if (!matchId || usedSections.has(matchId)) return null; // no/duplicate evidence
    usedSections.add(matchId);
    out.set(matchId, {
      holes: cluster.map(({ hole, par, line }) => ({ hole, par, line })),
      source: 'osm',
    });
  }
  return out.size === clusters.length ? out : null;
}

/** The whole section-splitting decision for one payload: lenient parse →
 *  cluster → evidence-label. Null at ANY uncertainty; a non-null map holds
 *  one clean per-section geometry per split loop. Exported pure for tests. */
export function resolveSectionGeometries(
  payload: unknown,
  sections: SectionRowLite[]
): Map<string, HoleGeometry> | null {
  if (!sections.length) return null;
  const ways = parseHoleWaysLenient(payload);
  if (!ways) return null;
  const clusters = clusterHoleLoops(ways);
  if (!clusters) return null;
  return assignClustersToSections(clusters, sections, payload);
}

/** A loop's label, by the compass bearing of its hole-1 tee from the
 *  centroid of every loop's hole-1 tee, clockwise from north: A, B, C…
 *  Deterministic, and NEVER a compass word — "North nine" that happened to
 *  be wrong is a wrong overlay; a letter is only an order. */
function labelLoops(loops: NamedHoleLine[][]): string[] {
  const tees = loops.map(l => l[0].line[0]);
  const clat = tees.reduce((s, t) => s + t[0], 0) / tees.length;
  const clng = tees.reduce((s, t) => s + t[1], 0) / tees.length;
  const bearing = (t: [number, number]) => {
    const y = t[1] - clng;
    const x = t[0] - clat;
    return (Math.atan2(y, x) * 180) / Math.PI + 360; // 0 = north, clockwise
  };
  const order = loops.map((_, i) => i).sort((a, b) => bearing(tees[a]) - bearing(tees[b]) || a - b);
  const labels = new Array<string>(loops.length);
  order.forEach((li, rank) => { labels[li] = String.fromCharCode(65 + rank); });
  return labels;
}

/** Tier 3 (sweep PR 4) — the club's hole ways split into CLEAN loops that
 *  nothing in OSM labels: stored as pickable `sections` ("A", "B", "C"…)
 *  with `holes: []`, so nothing is drawn before the player (or a clear GPS
 *  match) picks one. ONE promotion on evidence: the catalog row says 18
 *  holes and exactly one loop is an 18 → that loop IS the course's `holes`
 *  (the nine belongs to a sibling row, if one ever exists). Null when the
 *  loops do not cluster cleanly. Exported pure for tests. */
export function resolveLoopGeometry(payload: unknown, holesCount: number | null | undefined): HoleGeometry | null {
  const ways = parseHoleWaysLenient(payload);
  if (!ways) return null;
  const loops = clusterHoleLoops(ways);
  if (!loops || loops.length < 2) return null;
  const eighteens = loops.filter(l => l.length === 18);
  if (holesCount === 18 && eighteens.length === 1) {
    return { holes: eighteens[0].map(({ hole, par, line }) => ({ hole, par, line })), source: 'osm' };
  }
  const labels = labelLoops(loops);
  return {
    holes: [],
    source: 'osm',
    sections: loops.map((l, i) => ({ label: labels[i], holes: l.map(({ hole, par, line }) => ({ hole, par, line })) })),
  };
}

/** Merge two nine-hole geometries into one 18-hole geometry for a combo
 *  round's live map: front holes 1–9, back renumbered +9. Null unless BOTH
 *  sides are exactly nine holes numbered 1–9 — a half-right map lies. Pure. */
export function composeHoleGeometry(
  front: HoleGeometry | null | undefined,
  back: HoleGeometry | null | undefined
): HoleGeometry | null {
  const isNine = (g: HoleGeometry | null | undefined): g is HoleGeometry =>
    !!g && g.holes.length === 9 && g.holes.every(h => h.hole >= 1 && h.hole <= 9);
  if (!isNine(front) || !isNine(back)) return null;
  const composed: HoleGeometry = {
    ...(front.derived || back.derived ? { derived: 'features' as const } : {}),
    holes: [
      ...front.holes,
      ...back.holes.map(h => ({ ...h, hole: h.hole + 9 })),
    ].sort((a, b) => a.hole - b.hole),
    source: 'osm',
  };
  if (front.greens || back.greens) {
    composed.greens = [
      ...(front.greens ?? []),
      ...(back.greens ?? []).map(g => ({ ...g, hole: g.hole == null ? null : g.hole + 9 })),
    ].sort((a, b) => (a.hole ?? 99) - (b.hole ?? 99));
  }
  return composed;
}

/** Live yardage from the player's GPS fix to a hole's green — the OSM way
 *  runs tee→green, so the LAST point is the green (its center/front,
 *  approximately — this is "to green", never "to pin"; no pin data exists).
 *  Null past `maxYds`: someone peeking at a round from their couch gets no
 *  silly four-digit number. Pure, on-device — the fix never leaves the
 *  phone. */
export function greenDistanceYards(
  fix: [number, number],
  line: [number, number][],
  maxYds = 1500,
  green?: Ring | null
): number | null {
  if (line.length < 2) return null;
  const yds = yardsBetween(fix, greenPoint(line, green));
  return yds > maxYds ? null : yds;
}

/** THE point every "to green" number and the flag stand on: the outline's
 *  centroid when the hole carries one (PR G3 — OSM hole lines are hand-drawn
 *  and routinely stop at the front edge), else the line's last point. */
export function greenPoint(line: [number, number][], green?: Ring | null): [number, number] {
  const c = green ? ringCentroid(green) : null;
  return c ?? line[line.length - 1];
}

// YDS_PER_KM lives in green.ts (PR G1).

/** Great-circle yards between two [lat,lng] points, rounded. */
export function yardsBetween(a: [number, number], b: [number, number]): number {
  return Math.round(haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * YDS_PER_KM);
}

/** The drawn length of a tee→green way in yards — the hole's playing length
 *  as OSM mapped it (follows doglegs, tee marker to green centre). It is an
 *  approximation of the scorecard yardage, so callers label it "≈". Null
 *  under 2 points. Pure; used where the round carries no catalog yardage
 *  (every OSM-sourced course). */
export function polylineYards(line: [number, number][]): number | null {
  if (line.length < 2) return null;
  let km = 0;
  for (let i = 1; i < line.length; i++) {
    km += haversineKm(
      { lat: line[i - 1][0], lng: line[i - 1][1] },
      { lat: line[i][0], lng: line[i][1] }
    );
  }
  return Math.round(km * YDS_PER_KM);
}

/** Start the hole at the tee-in-play. The OSM way runs from its first node —
 *  in practice the BACK tee — so the line, the tee label and every "from
 *  tee" number started from the tips whatever tee the round was played
 *  from (Tom's on-course report). The cached geometry carries no golf=tee
 *  features, but the round carries the selected tee's scorecard yardage per
 *  hole: walk BACK from the green along the drawn line by that yardage and
 *  start there (interpolated on the segment it lands in). Unchanged when
 *  the yardage is missing/invalid or ≥ the drawn length. Pure. */
export function trimLineToYards(
  line: [number, number][],
  yards: number | null | undefined
): [number, number][] {
  if (line.length < 2 || typeof yards !== 'number' || !Number.isFinite(yards) || yards <= 0) return line;
  const km = yards / YDS_PER_KM;
  let acc = 0;
  for (let i = line.length - 1; i > 0; i--) {
    const a = line[i]; // nearer the green
    const b = line[i - 1]; // nearer the tee
    const seg = haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    if (acc + seg >= km) {
      const t = seg > 0 ? (km - acc) / seg : 0;
      const start: [number, number] = [
        Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
        Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
      ];
      return [start, ...line.slice(i)];
    }
    acc += seg;
  }
  return line; // yardage ≥ drawn length: the back tee IS the tee-in-play
}

/** The rangefinder's two numbers for a player-placed target on the focused
 *  hole: origin→target (the shot) and target→green (what's left). Origin is
 *  the live fix when tracking, else the tee — planning works from the couch.
 *  No sanity cap: the target was placed deliberately. Pure, on-device. */
export function targetDistances(
  origin: [number, number],
  target: [number, number],
  line: [number, number][],
  green?: Ring | null
): { toTarget: number; targetToGreen: number } | null {
  if (line.length < 2) return null;
  return {
    toTarget: yardsBetween(origin, target),
    targetToGreen: yardsBetween(target, greenPoint(line, green)),
  };
}

export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
export const OVERPASS_UA = 'EdgeAthlete/1.0 (https://edgeathlete.ca)';

/** A REAL Overpass answer carries its envelope (`version` / `generator` /
 *  `osm3s`) and an `elements` array. A throttling mirror answers 200 with a
 *  21-byte stub, and a stub parsed as "no coverage" used to be STAMPED for
 *  30 days (the sweep program's prep, Oct 2026): anything without the
 *  envelope is a transport failure — next mirror, nothing stamped. Exported
 *  pure for tests and for the regional sweep. */
export function isOverpassAnswer(payload: unknown): payload is { elements: OverpassElement[] } {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { elements?: unknown; version?: unknown; generator?: unknown; osm3s?: unknown };
  if (!Array.isArray(p.elements)) return false;
  return p.version !== undefined || p.generator !== undefined || p.osm3s !== undefined;
}

export interface HoleGeometryFetch {
  /** False = every mirror failed (transport) — the caller must NOT cache the
   *  attempt, so the next budgeted request retries. True with null geometry
   *  = OSM genuinely has no unambiguous data here — cache THAT for 30 days. */
  reached: boolean;
  geometry: HoleGeometry | null;
  /** The raw Overpass payload the answer came from — lets the cache layer
   *  attempt the multi-course section split without a second fetch. */
  payload?: unknown;
}

/** Fetch golf=hole ways around a course location, plus the course boundary
 *  polygons that let `scopeHoleGeometry` untangle multi-course facilities.
 *  One request; the plain parse is tried first (identical to the historical
 *  behavior — clean courses can't regress), the boundary-scoped parse only
 *  when it rejects and a course name is available. */
export async function fetchHoleGeometry(
  lat: number,
  lng: number,
  courseName?: string | null
): Promise<HoleGeometryFetch> {
  const around = `(around:1500,${lat},${lng})`;
  const query =
    `[out:json][timeout:25];way["golf"="hole"]${around};out geom;` +
    // The green outlines (PR G2) — light, so they sit BEFORE the boundary
    // statement: a timeout still lands in the heaviest statement, and
    // isOverpassPartial turns that into a transport failure as before.
    `(way["golf"="green"]${around};relation["golf"="green"]${around};);out geom;` +
    // Named boundaries only — unnamed polygons are dropped by the scoper
    // anyway, and a smaller statement is less likely to time out.
    `(way["leisure"="golf_course"]["name"]${around};relation["leisure"="golf_course"]["name"]${around};);out geom;`;
  for (const endpoint of MIRRORS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 26000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue; // 504 load-shedding is routine — try the mirror
      // A clean-but-invalid response (ambiguous refs, no coverage) is a real
      // answer, not a transport failure.
      const payload = await res.json();
      // A 200 without the Overpass envelope (a throttling mirror's stub)
      // or with a runtime-error remark is NOT a "no coverage" answer —
      // next mirror; all failing → reached:false, so nothing is stamped
      // and a later request retries.
      if (!isOverpassAnswer(payload) || isOverpassPartial(payload)) continue;
      const resolved = resolveHoleGeometry(payload, courseName, [lat, lng]);
      const geometry = resolved ? withGreens(resolved, payload) : null;
      return { reached: true, geometry, payload };
    } catch {
      // Timeout/network — next mirror.
    }
  }
  return { reached: false, geometry: null };
}

const GEOMETRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The cache layer the API serves: 30-day cache in golf_courses (attempted
 *  marker included — a no-coverage answer is an answer), budget-gated fetch,
 *  transport failures never stamped so they retry on a later request. */
export async function getCourseHoleGeometry(
  admin: SupabaseClient,
  courseId: string,
  consumeBudget: () => Promise<boolean>
): Promise<HoleGeometry | null> {
  const { data } = await admin
    .from('golf_courses')
    .select('id, name, lat, lng, hole_geometry, hole_geometry_at, club_id, holes_count')
    .eq('id', courseId)
    .maybeSingle();
  const row = data as {
    name: string | null;
    lat: number | null;
    lng: number | null;
    hole_geometry: HoleGeometry | null;
    hole_geometry_at: string | null;
    club_id?: string | null;
    holes_count?: number | null;
  } | null;
  if (!row) return null;
  if (
    row.hole_geometry_at &&
    Date.now() - new Date(row.hole_geometry_at).getTime() < GEOMETRY_TTL_MS &&
    // A geometry cached before PR G2 carries no `greens` key: refetch it ONCE
    // (the write below always sets the key, `[]` included). A null answer
    // keeps its own 30-day TTL — there is nothing to add to "no coverage".
    (row.hole_geometry == null || 'greens' in row.hole_geometry)
  ) {
    return row.hole_geometry;
  }
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number') return row.hole_geometry;
  if (!(await consumeBudget())) return row.hole_geometry; // no stamp — retry later
  const result = await fetchHoleGeometry(row.lat, row.lng, row.name);
  if (!result.reached) return row.hole_geometry; // transport-only failure — no stamp
  let geometry = result.geometry;

  // Multi-course club whose payload the strict/scoped parse refused
  // (duplicate refs inside one boundary): try the section split. One fetch
  // labels EVERY sibling it can prove, each written to its own row — and a
  // null stays a real, stamped "ambiguous" answer, retried in 30 days.
  if (!geometry && row.club_id && result.payload) {
    try {
      const { data: siblingRows } = await admin
        .from('golf_courses')
        .select('id, name, section_name')
        .eq('club_id', row.club_id)
        .not('section_name', 'is', null);
      const sections = (siblingRows ?? []) as Array<{ id: string; name: string; section_name: string | null }>;
      // The split sees THIS course's ways (the claims scope), never a
      // neighbour's: Royal Ottawa's 27 alone, not the cluster's 45.
      const elements = (result.payload as { elements?: OverpassElement[] }).elements ?? [];
      const assigned = resolveSectionGeometries(scopedPayload(elements, scopeHoleWays(elements, row.name, [row.lat, row.lng])), sections);
      if (assigned) {
        const stamp = new Date().toISOString();
        for (const [sectionId, geo] of assigned) {
          if (sectionId === courseId) continue; // this row is stamped below
          await admin
            .from('golf_courses')
            // Each sibling picks its own greens out of the ONE payload (the
            // assignment is by its holes' line ends).
            .update({ hole_geometry: withGreens(geo, result.payload), hole_geometry_at: stamp })
            .eq('id', sectionId);
        }
        const own = assigned.get(courseId);
        geometry = own ? withGreens(own, result.payload) : null;
      }
    } catch (sectionError) {
      console.error('Section geometry split failed (non-fatal):', sectionError);
    }
  }

  // Tier 3 (sweep PR 4): clean loops nothing labels → pickable sections
  // (or the one 18 the catalog vouches for), over THIS course's ways.
  if (!geometry && result.payload) {
    const elements = (result.payload as { elements?: OverpassElement[] }).elements ?? [];
    const scoped = scopedPayload(elements, scopeHoleWays(elements, row.name, [row.lat, row.lng]));
    const loops = resolveLoopGeometry(scoped, row.holes_count);
    if (loops) geometry = withGreens(loops, scoped);
  }
  // Tier 5 (sweep PR 3): no lines anywhere, but the greens are drawn —
  // keep them unnumbered for the nearest-green rangefinder.
  if (!geometry && result.payload) {
    geometry = greensOnlyGeometry(result.payload, row.name, [row.lat, row.lng]);
  }

  await admin
    .from('golf_courses')
    .update({ hole_geometry: geometry, hole_geometry_at: new Date().toISOString() })
    .eq('id', courseId);
  return geometry;
}
