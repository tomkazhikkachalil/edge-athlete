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
// Overpass etiquette: server-side only, descriptive UA, one fetch per course
// per 30 days (cached in golf_courses.hole_geometry / hole_geometry_at,
// migration 102), budgeted via the provider budget like everything else.
// The public servers shed load with 504s routinely (observed while building
// this) — hence the mirror ladder and the always-safe null.

import type { SupabaseClient } from '@supabase/supabase-js';

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

interface OverpassElement {
  type?: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
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

/** Fetch golf=hole ways around a course location. */
export async function fetchHoleGeometry(lat: number, lng: number): Promise<HoleGeometryFetch> {
  const query = `[out:json][timeout:25];way["golf"="hole"](around:1500,${lat},${lng});out geom;`;
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
      return { reached: true, geometry: parseHoleGeometry(await res.json()) };
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
    .select('id, lat, lng, hole_geometry, hole_geometry_at')
    .eq('id', courseId)
    .maybeSingle();
  const row = data as {
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
  const result = await fetchHoleGeometry(row.lat, row.lng);
  if (!result.reached) return row.hole_geometry; // transport-only failure — no stamp
  await admin
    .from('golf_courses')
    .update({ hole_geometry: result.geometry, hole_geometry_at: new Date().toISOString() })
    .eq('id', courseId);
  return result.geometry;
}
