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

export interface HoleLine {
  hole: number;
  par: number | null;
  /** Tee→green polyline, [lat,lng] pairs, 6dp. line[0] is the tee,
   *  line[line.length-1] the green (OSM drawing convention). */
  line: [number, number][];
}

export interface HoleGeometry {
  holes: HoleLine[];
  source: 'osm';
}

interface OverpassMember {
  type?: string;
  role?: string;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassElement {
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

type Ring = [number, number][]; // [lat,lng] vertices; first === last when closed

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

/** Ray-cast point-in-ring; lat is y, lng is x. */
function pointInRing(pt: [number, number], ring: Ring): boolean {
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

/** Second chance for a payload the plain parse rejected: pick the ONE
 *  `leisure=golf_course` boundary whose name best matches the catalog course
 *  (strict-max score ≥ 1 — a tie or no match gives up), keep only hole ways
 *  whose midpoint lies inside it, and re-apply the same strict parse. Null
 *  stays the answer for genuinely ambiguous clubs whose own boundary holds
 *  duplicate refs. Exported pure for tests. */
export function scopeHoleGeometry(payload: unknown, courseName: string): HoleGeometry | null {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements) || !courseName.trim()) return null;

  const boundaries: { rings: Ring[]; score: number }[] = [];
  for (const el of elements) {
    const tags = el?.tags ?? {};
    if (tags.leisure !== 'golf_course' || !tags.name) continue;
    const score = courseNameScore(courseName, tags.name);
    if (score === 0) continue;
    let rings: Ring[] = [];
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      rings = assembleRings([el.geometry.filter(validPt).map(g => [g.lat, g.lon] as [number, number])]);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      rings = assembleRings(
        el.members
          .filter(m => m?.type === 'way' && (!m.role || m.role === 'outer') && Array.isArray(m.geometry))
          .map(m => m.geometry!.filter(validPt).map(g => [g.lat, g.lon] as [number, number]))
      );
    }
    if (rings.length) boundaries.push({ rings, score });
  }
  if (!boundaries.length) return null;
  // OSM double-tagging: a closed way tagged leisure=golf_course that is ALSO
  // the outer member of a same-named multipolygon relation arrives as two
  // candidates with equal score — the tie rule nulled the course for 30
  // days although both describe the same ring. Collapse identical GEOMETRY
  // before the tie test; two different polygons sharing a name remain a
  // genuine ambiguity and still null.
  const seen = new Set<string>();
  const distinct = boundaries.filter(b => {
    const sig = ringSignature(b.rings);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  distinct.sort((a, b) => b.score - a.score);
  if (distinct.length > 1 && distinct[0].score === distinct[1].score) return null;
  const chosen = distinct[0];

  const scoped = elements.filter(el => {
    if (el?.tags?.golf !== 'hole') return false;
    const pts = (el.geometry ?? []).filter(validPt);
    if (!pts.length) return false;
    const mid = pts[Math.floor(pts.length / 2)];
    return chosen.rings.some(r => pointInRing([mid.lat, mid.lon], r));
  });
  return parseHoleGeometry({ elements: scoped });
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
  maxYds = 1500
): number | null {
  if (line.length < 2) return null;
  const yds = yardsBetween(fix, line[line.length - 1]);
  return yds > maxYds ? null : yds;
}

const YDS_PER_KM = 1093.6133;

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
  line: [number, number][]
): { toTarget: number; targetToGreen: number } | null {
  if (line.length < 2) return null;
  return {
    toTarget: yardsBetween(origin, target),
    targetToGreen: yardsBetween(target, line[line.length - 1]),
  };
}

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OVERPASS_UA = 'EdgeAthlete/1.0 (https://edge-athlete.vercel.app)';

export interface HoleGeometryFetch {
  /** False = every mirror failed (transport) — the caller must NOT cache the
   *  attempt, so the next budgeted request retries. True with null geometry
   *  = OSM genuinely has no unambiguous data here — cache THAT for 30 days. */
  reached: boolean;
  geometry: HoleGeometry | null;
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
    // Named boundaries only — unnamed polygons are dropped by the scoper
    // anyway, and a smaller second statement is less likely to time out.
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
      // A 200 with a runtime-error remark is a TRUNCATED answer, not a
      // "no coverage" answer — next mirror; all partial → reached:false,
      // so nothing is stamped and a later request retries.
      if (isOverpassPartial(payload)) continue;
      const geometry =
        parseHoleGeometry(payload) ?? (courseName ? scopeHoleGeometry(payload, courseName) : null);
      return { reached: true, geometry };
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
    .select('id, name, lat, lng, hole_geometry, hole_geometry_at')
    .eq('id', courseId)
    .maybeSingle();
  const row = data as {
    name: string | null;
    lat: number | null;
    lng: number | null;
    hole_geometry: HoleGeometry | null;
    hole_geometry_at: string | null;
  } | null;
  if (!row) return null;
  if (
    row.hole_geometry_at &&
    Date.now() - new Date(row.hole_geometry_at).getTime() < GEOMETRY_TTL_MS
  ) {
    return row.hole_geometry;
  }
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number') return row.hole_geometry;
  if (!(await consumeBudget())) return row.hole_geometry; // no stamp — retry later
  const result = await fetchHoleGeometry(row.lat, row.lng, row.name);
  if (!result.reached) return row.hole_geometry; // transport-only failure — no stamp
  await admin
    .from('golf_courses')
    .update({ hole_geometry: result.geometry, hole_geometry_at: new Date().toISOString() })
    .eq('id', courseId);
  return result.geometry;
}
