/**
 * The global golf course catalog — DB-backed rows + two external providers.
 *
 * Replaces the 7-course static file (golf-courses-db.ts) and the never-
 * configured provider scaffolding (golf-course-service.ts), both deleted.
 * ALL provider surface lives here, behind two hard rules:
 *
 *   1. Providers are NEVER in the keystroke path. They are called in exactly
 *      two places: the explicit "search worldwide" action (globalSearch) and
 *      hydration when a thin row is selected (hydrateCourse). Typeahead is
 *      always a pure catalog read.
 *   2. Budget guards are FAIL-CLOSED — the opposite polarity from
 *      enforceRateLimit's fail-open, deliberately: degrading to local
 *      results is free, burning a 50-requests/day provider budget is not.
 *
 * Sources (golf_courses.external_source):
 *   'seed'          — the 7 carried-over static courses (migration 100)
 *   'opengolfapi'   — keyless, US-complete (~16.8k). ODbL: attribution
 *                     REQUIRED wherever its rows render (OPENGOLF_ATTRIBUTION).
 *   'golfcourseapi' — global (~30k), needs GOLF_COURSE_API_KEY; free tier is
 *                     50 req/DAY, hence the tight default budget.
 *   'osm'           — worldwide OpenStreetMap import (leisure=golf_course,
 *                     bulk-harvested via Overpass; external_id "way/123" /
 *                     "relation/456"). Identity-only rows: name + coords, no
 *                     tees/ratings ever — no provider can hydrate them, so
 *                     hydration only reverse-fills city/region/country. ODbL
 *                     attribution: OSM_ATTRIBUTION is sent on EVERY search
 *                     response (catalogAttribution), providers on or off.
 *                     A provider hit that lands on an OSM-only neighbour
 *                     ADOPTS that row rather than being skipped — see
 *                     adoptionDecision.
 *
 * Both providers' search results are THIN (no ratings/holes) — full tee and
 * hole data arrives only from the per-course detail endpoint at hydration.
 * We never fabricate data: a course without hole data keeps hole_data: [] and
 * the composer's standard-par fallback covers it.
 *
 * Response shapes below were pinned against LIVE responses (Aug 2026), not
 * docs alone — the old scaffolding died of guessed shapes. Notably
 * GolfCourseAPI's detail nests under a `course` key (its spec says bare).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GolfCourse, CourseHole } from '@/types/golf';
import { tidyCourseName } from '@/lib/golf/tees';
import { acceptGeocode, geocodeGolfCourse, reverseGeocodeCourse, shouldReplaceCoords } from '@/lib/golf/geocode';
import { courseNameScore } from '@/lib/golf/hole-geometry';

/** ODbL attribution for the catalog. The OSM line is owed UNCONDITIONALLY —
 *  28.9k rows are OpenStreetMap-sourced directly and render whether or not
 *  any provider is configured; "via OpenGolfAPI" is appended only while that
 *  provider is on (its rows are OSM-derived too). Gating the whole line on
 *  providersConfigured() was a licence gap the moment OSM became a source. */
export const OSM_ATTRIBUTION = 'Course data © OpenStreetMap contributors (ODbL)';
export const OPENGOLF_ATTRIBUTION = `${OSM_ATTRIBUTION}, some via OpenGolfAPI`;
export function catalogAttribution(providersOn: boolean): string {
  return providersOn ? OPENGOLF_ATTRIBUTION : OSM_ATTRIBUTION;
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROVIDER_TIMEOUT_MS = 5000;

// ── Catalog row ──────────────────────────────────────────────────────────────

export interface CatalogRow {
  id: string;
  external_source: 'seed' | 'opengolfapi' | 'golfcourseapi' | 'osm';
  external_id: string;
  name: string;
  club_name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  total_par: number | null;
  holes_count: number | null;
  hole_data: CourseHole[] | null;
  course_rating: Record<string, number>;
  slope_rating: Record<string, number>;
  lat: number | null;
  lng: number | null;
  description: string | null;
  description_attribution: string | null;
  architect: string | null;
  year_built: number | null;
  course_type: string | null;
  website: string | null;
  phone: string | null;
  hydrated_at: string | null;
}

export const CATALOG_ROW_COLUMNS =
  'id, external_source, external_id, name, club_name, city, region, country, total_par, holes_count, hole_data, course_rating, slope_rating, lat, lng, description, description_attribution, architect, year_built, course_type, website, phone, hydrated_at';

/** Row → the flat GolfCourse the composer consumes. */
export function rowToCourse(row: CatalogRow): GolfCourse {
  return {
    id: row.id,
    name: row.name,
    // Lets the picker say the truth per row: an 'osm' row is identity-only
    // FOREVER (no provider knows its id), so "details load when selected"
    // would be a lie for the majority of the catalog.
    source: row.external_source,
    city: row.city ?? undefined,
    state: row.region ?? undefined,
    country: row.country ?? undefined,
    holes: row.hole_data ?? [],
    totalPar: row.total_par ?? 72,
    holesCount: row.holes_count ?? undefined,
    courseRating: row.course_rating ?? {},
    slopeRating: row.slope_rating ?? {},
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    description: row.description ?? undefined,
    descriptionAttribution: row.description_attribution ?? undefined,
    architect: row.architect ?? undefined,
    yearBuilt: row.year_built ?? undefined,
    courseType: row.course_type ?? undefined,
    website: row.website ?? undefined,
  };
}

/** Thin = identity only; worth a hydration call on selection. */
export function isThinRow(row: Pick<CatalogRow, 'hole_data' | 'course_rating' | 'slope_rating'>): boolean {
  return (
    (!row.hole_data || row.hole_data.length === 0) &&
    Object.keys(row.course_rating ?? {}).length === 0 &&
    Object.keys(row.slope_rating ?? {}).length === 0
  );
}

// ── Pure ranking (mirrors src/lib/search/people.ts's ladder) ─────────────────

/** 0 exact · 1 prefix · 2 word-boundary prefix · 3 substring · 4 no match. */
export function rankCourseName(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 3;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(` ${q}`)) return 2;
  if (n.includes(q)) return 3;
  return 4;
}

/**
 * Best rank across the searchable fields. The #199 rewrite matched name
 * ONLY, which silently orphaned location queries — "ottawa" stopped finding
 * Rideau View and Eagle Creek (Ottawa lives in their city, not their name).
 * Location fields rank one step behind the same-strength name match so
 * name hits stay on top.
 */
export function rankCourseFields(
  row: Pick<CatalogRow, 'name' | 'club_name' | 'city' | 'region'>,
  query: string
): number {
  const nameRank = rankCourseName(row.name, query);
  const others = [row.club_name, row.city, row.region]
    .filter((v): v is string => !!v)
    .map(v => rankCourseName(v, query));
  const otherRank = others.length ? Math.min(...others) + 1 : 5;
  return Math.min(nameRank, otherRank);
}

/** "{club} – {course}" unless the course name already carries the club. */
export function courseDisplayName(clubName: string | null | undefined, courseName: string): string {
  const club = (clubName ?? '').trim();
  const course = courseName.trim();
  if (!club || course.toLowerCase().includes(club.toLowerCase())) return course;
  return `${club} – ${course}`;
}

const nullIfUnknown = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return !s || s.toLowerCase() === 'unknown' ? null : s;
};

// ── Catalog reads ────────────────────────────────────────────────────────────

/** Substring matching from 2 chars here (vs the app-wide 3). At ~29k rows
 *  (worldwide OSM import, Aug 2026) a 2-char substring over four columns is
 *  a seq scan — pg_trgm needs 3 chars — but it measures ~10–30 ms in
 *  Postgres, and course names are routinely found by 2-char starts ("st",
 *  "pe"). Relevance, not speed, is the scale problem; see searchCatalog. */
const COURSE_WIDE_MATCH_MIN_CHARS = 2;

/** LIKE-safe query text. PostgREST .or() is comma/paren-delimited and
 *  escapeLikePattern doesn't cover those — strip them so a pasted
 *  "Club, The (North)" can't corrupt the filter. Also escape LIKE wildcards. */
function likeSafe(q: string): string {
  return q.replace(/[,()]/g, ' ').replace(/[%_\\]/g, m => `\\${m}`).trim();
}

function coursePattern(q: string): string {
  const safe = likeSafe(q);
  return q.length < COURSE_WIDE_MATCH_MIN_CHARS ? `${safe}%` : `%${safe}%`;
}

/**
 * Merge the search passes into the final page — exported pure for tests.
 *
 * `rows` arrive in DB order: the name-PREFIX pass first, then the wide
 * name/club/city/region pass, each ordered `hydrated_at DESC NULLS LAST,
 * name` (touched courses float). Dedupe by id keeping the FIRST occurrence,
 * then a STABLE sort by (rank ladder, richness) so DB order survives inside
 * a tier.
 *
 * Richness breaks ties between same-rank rows: a row with real tees/holes
 * (a seed, or a hydrated provider row) beats one that only knows its city,
 * which beats a bare identity row. Three OSM rows are named exactly "Eagle
 * Creek Golf Club"; without this the seeded Ottawa one — the row with the
 * scorecard — sat 6th behind them on arbitrary tie order (probe, Aug 24).
 *
 * An empty query is a browse: no ladder at all. Every row ties on rank
 * there, and the old `name.localeCompare` tiebreak re-alphabetised the page
 * — which threw the hydrated_at order away and put `'t Kruisselt` and
 * `"Ground Golf"` at the head of prod's browse (probe-caught, Aug 24).
 */
export function mergeSearchRows(rows: CatalogRow[], query: string, limit: number): CatalogRow[] {
  const q = query.trim();
  const seen = new Set<string>();
  const unique: CatalogRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  if (!q) return unique.slice(0, limit);
  const richness = (row: CatalogRow) => (!isThinRow(row) ? 0 : row.city ? 1 : 2);
  return unique
    .map((row, index) => ({ row, index, rank: rankCourseFields(row, q), rich: richness(row) }))
    .sort((a, b) => a.rank - b.rank || a.rich - b.rich || a.index - b.index)
    .slice(0, limit)
    .map(({ row }) => row);
}

/**
 * Two passes, both DB-ordered, merged by mergeSearchRows.
 *
 * Why two: at 68 rows one `ORDER BY name LIMIT limit*5` window covered the
 * whole match set and the JS ladder could always promote exact/prefix hits.
 * At 29k rows `q='ka'` (`%ka%`, ~465 matches) returned the alphabetically
 * first 50 — Karachi and Katrine CITY matches — and never showed "Kanata
 * Golf Club", a NAME prefix that sorts later (probe-caught, Aug 24). The
 * prefix pass guarantees name-prefix hits are in the window; ordering every
 * pass by hydrated_at first means the courses people actually use lead it.
 * Both run concurrently — no added latency, trivial extra load.
 */
export async function searchCatalog(
  admin: SupabaseClient,
  query: string,
  limit: number
): Promise<GolfCourse[]> {
  const q = query.trim();
  const ordered = () =>
    admin
      .from('golf_courses')
      .select(CATALOG_ROW_COLUMNS)
      .order('hydrated_at', { ascending: false, nullsFirst: false })
      .order('name');
  if (!q) {
    // Browse head: with the worldwide import the alphabetical head is 29k
    // rows of never-selected long tail — hydrated_at surfaces touched courses.
    const { data, error } = await ordered().limit(limit);
    if (error || !data) return [];
    return mergeSearchRows(data as unknown as CatalogRow[], '', limit).map(rowToCourse);
  }
  const p = coursePattern(q);
  // Prefix window is 3× the page: at 29k rows "ka%" alone matches ~100 names,
  // and the richness tiebreak can only promote rows it was handed.
  const [prefix, wide] = await Promise.all([
    ordered().ilike('name', `${likeSafe(q)}%`).limit(limit * 3),
    ordered()
      .or(`name.ilike.${p},club_name.ilike.${p},city.ilike.${p},region.ilike.${p}`)
      .limit(limit * 5),
  ]);
  if (prefix.error && wide.error) return [];
  const rows = [...(prefix.data ?? []), ...(wide.data ?? [])] as unknown as CatalogRow[];
  return mergeSearchRows(rows, q, limit).map(rowToCourse);
}

export async function getCatalogRow(admin: SupabaseClient, id: string): Promise<CatalogRow | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await admin
    .from('golf_courses')
    .select(CATALOG_ROW_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as CatalogRow) ?? null;
}

// ── Budget guard (fail-closed) ───────────────────────────────────────────────

const DEFAULT_BUDGETS: Record<string, number> = {
  opengolfapi: 1000,
  golfcourseapi: Number(process.env.GOLF_PROVIDER_DAILY_BUDGET) || 45,
  // Nominatim coord refinement — one call per course per hydration (7-day
  // TTL), so this is headroom, not a target. Policy compliance lives in
  // geocode.ts (UA, never per-keystroke).
  nominatim: 500,
  // Overpass hole-geometry fetches — one per course per 30 days (cached in
  // hole_geometry_at). Etiquette lives in hole-geometry.ts.
  overpass: 200,
};

/** Exported for the hole-geometry cache (same budget machinery, its own key). */
export async function consumeProviderBudget(admin: SupabaseClient, source: string): Promise<boolean> {
  try {
    const { data, error } = await admin
      .rpc('rate_limit_hit', {
        p_key: `golf-provider:${source}`,
        p_max: DEFAULT_BUDGETS[source] ?? 45,
        p_window_seconds: 86400,
      })
      .single();
    if (error) return false; // fail CLOSED — protect the budget, serve local
    return (data as { allowed: boolean }).allowed === true;
  } catch {
    return false;
  }
}

// ── Provider: OpenGolfAPI (keyless; live shapes pinned Aug 2026) ─────────────

interface OpenGolfSummary {
  id: string; // UUID
  course_name: string;
  city?: string | null;
  state?: string | null;
  country_iso?: string | null;
  lat?: number | null;
  lng?: number | null;
  par?: number | null;
  holes?: number | null;
}

interface OpenGolfTee {
  tee_name?: string | null;
  tee_color?: string | null;
  gender?: string | null;
  course_rating?: number | null;
  slope?: number | null;
}

interface OpenGolfDetail extends OpenGolfSummary {
  club_name?: string | null;
  description?: string | null;
  description_source?: { name?: string | null; license?: string | null; url?: string | null } | null;
  architect?: string | null;
  year_built?: number | null;
  type?: string | null;
  website?: string | null;
  phone?: string | null;
  tees?: OpenGolfTee[] | null;
  holes_data?: Array<{
    number: number;
    par: number;
    handicap_index?: number | null;
    yardages?: Record<string, number> | null;
  }> | null;
}

type NewRow = Omit<CatalogRow, 'id'>;

const NO_DETAILS = {
  description: null,
  description_attribution: null,
  architect: null,
  year_built: null,
  course_type: null,
  website: null,
  phone: null,
  hydrated_at: null,
} as const;

export function normalizeOpenGolfSummary(s: OpenGolfSummary): NewRow {
  return {
    ...NO_DETAILS,
    external_source: 'opengolfapi',
    external_id: s.id,
    name: tidyCourseName(s.course_name),
    club_name: null,
    city: nullIfUnknown(s.city),
    region: nullIfUnknown(s.state),
    country: nullIfUnknown(s.country_iso),
    total_par: s.par ?? null,
    holes_count: s.holes ?? null,
    hole_data: null,
    course_rating: {},
    slope_rating: {},
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  };
}

/** Fold a provider tee list into {teeKey: value} maps. Male tees claim their
 *  key first; a female tee whose key collides gets a " (f)" suffix. */
function foldTees(
  tees: Array<{ key: string; female: boolean; rating: number | null; slope: number | null }>
): { rating: Record<string, number>; slope: Record<string, number> } {
  const rating: Record<string, number> = {};
  const slope: Record<string, number> = {};
  const ordered = [...tees.filter(t => !t.female), ...tees.filter(t => t.female)];
  for (const t of ordered) {
    let key = t.key;
    if (!key) continue;
    if (t.female && (key in rating || key in slope)) key = `${key} (f)`;
    if (t.rating != null && !(key in rating)) rating[key] = t.rating;
    if (t.slope != null && !(key in slope)) slope[key] = t.slope;
  }
  return { rating, slope };
}

export function normalizeOpenGolfDetail(d: OpenGolfDetail): NewRow {
  const { rating, slope } = foldTees(
    (d.tees ?? []).map(t => ({
      key: (t.tee_color || t.tee_name || '').toLowerCase().trim(),
      female: (t.gender ?? '').toLowerCase() === 'female',
      rating: t.course_rating ?? null,
      slope: t.slope ?? null,
    }))
  );
  const holes: CourseHole[] = (d.holes_data ?? []).map(h => ({
    number: h.number,
    par: h.par,
    yardage: h.yardages ?? {},
    handicap: h.handicap_index ?? 0,
  }));
  const wiki = d.description_source;
  return {
    ...NO_DETAILS,
    description: d.description ?? null,
    // CC BY-SA (Wikipedia) — displaying this line wherever the description
    // renders is a license requirement, not decoration.
    description_attribution: d.description && wiki?.name
      ? `Description: ${wiki.name}${wiki.license ? ` (${wiki.license})` : ''}`
      : null,
    architect: d.architect ?? null,
    year_built: d.year_built ?? null,
    course_type: d.type ?? null,
    website: d.website ?? null,
    phone: d.phone ?? null,
    external_source: 'opengolfapi',
    external_id: d.id,
    name: courseDisplayName(d.club_name, tidyCourseName(d.course_name)),
    club_name: nullIfUnknown(d.club_name),
    city: nullIfUnknown(d.city),
    region: nullIfUnknown(d.state),
    country: nullIfUnknown(d.country_iso) ?? 'US',
    total_par: d.par ?? null,
    holes_count: d.holes ?? (holes.length || null),
    hole_data: holes.length ? holes : null,
    course_rating: rating,
    slope_rating: slope,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
  };
}

// ── Provider: GolfCourseAPI (Bearer key; live shapes pinned Aug 2026) ────────

interface GcaSummary {
  id: string; // opaque 8-char
  club_name?: string | null;
  course_name?: string | null;
  location?: { city?: string | null; state?: string | null; country?: string | null } | null;
}

interface GcaTeeBox {
  tee_name?: string | null;
  course_rating?: number | null;
  slope_rating?: number | null;
  number_of_holes?: number | null;
  par_total?: number | null;
  holes?: Array<{ par?: number | null; yardage?: number | null; handicap?: number | null }> | null;
}

interface GcaDetail extends GcaSummary {
  tees?: { male?: GcaTeeBox[] | null; female?: GcaTeeBox[] | null } | null;
}

export function normalizeGcaSummary(s: GcaSummary): NewRow {
  const courseName = (s.course_name || s.club_name || '').trim();
  return {
    ...NO_DETAILS,
    external_source: 'golfcourseapi',
    external_id: s.id,
    name: courseDisplayName(s.club_name, courseName),
    club_name: nullIfUnknown(s.club_name),
    city: nullIfUnknown(s.location?.city),
    region: nullIfUnknown(s.location?.state),
    country: nullIfUnknown(s.location?.country),
    total_par: null,
    holes_count: null,
    hole_data: null,
    course_rating: {},
    slope_rating: {},
    lat: null,
    lng: null,
  };
}

export function normalizeGcaDetail(d: GcaDetail): NewRow {
  const male = d.tees?.male ?? [];
  const female = d.tees?.female ?? [];
  const { rating, slope } = foldTees([
    ...male.map(t => ({
      key: (t.tee_name ?? '').toLowerCase().trim(),
      female: false,
      rating: t.course_rating ?? null,
      slope: t.slope_rating ?? null,
    })),
    ...female.map(t => ({
      key: (t.tee_name ?? '').toLowerCase().trim(),
      female: true,
      rating: t.course_rating ?? null,
      slope: t.slope_rating ?? null,
    })),
  ]);

  // Reference tee = first male box with the most holes (fallback: female).
  const boxes = [...male, ...female];
  const reference = boxes.reduce<GcaTeeBox | null>(
    (best, t) => ((t.holes?.length ?? 0) > (best?.holes?.length ?? 0) ? t : best),
    null
  );
  const refHoles = reference?.holes ?? [];
  // Holes are POSITIONAL (no number field) — number them 1..n; only boxes
  // with the same hole count contribute per-hole yardage.
  const holes: CourseHole[] = refHoles.map((h, i) => {
    const yardage: Record<string, number> = {};
    for (const box of boxes) {
      const key = (box.tee_name ?? '').toLowerCase().trim();
      const y = box.holes?.length === refHoles.length ? box.holes?.[i]?.yardage : null;
      if (key && y != null && !(key in yardage)) yardage[key] = y;
    }
    return { number: i + 1, par: h.par ?? 4, yardage, handicap: h.handicap ?? 0 };
  });

  const base = normalizeGcaSummary(d);
  return {
    ...base,
    total_par: reference?.par_total ?? null,
    holes_count: reference?.number_of_holes ?? (holes.length || null),
    hole_data: holes.length ? holes : null,
    course_rating: rating,
    slope_rating: slope,
  };
}

// ── Source: OpenStreetMap bulk import (Overpass `out tags center`) ───────────

export interface OsmCourseElement {
  type?: string; // 'way' | 'relation'
  id?: number;
  tags?: Record<string, string>;
  center?: { lat?: number; lon?: number };
}

/** leisure=golf_course elements that are facilities, not playable courses.
 *  Filtered by TAG first (golf=driving_range is authoritative), then by the
 *  narrow name patterns below — kept conservative on purpose: a false
 *  positive here silently deletes a real course from the catalog. */
const OSM_NOISE_NAME = /\b(driving\s*range|practice\s*(range|center|centre)|miniature\s*golf|mini[- ]?putt)\b/i;

/** Overpass element → thin catalog row, or null when it isn't a course we
 *  want (no name, no center coords, driving range / mini-putt). Exported
 *  pure for tests and for the import script's dry-run. */
export function normalizeOsmElement(el: OsmCourseElement): NewRow | null {
  const tags = el.tags ?? {};
  const name = (tags.name ?? '').trim();
  const lat = el.center?.lat;
  const lng = el.center?.lon;
  if (!name || !el.id || (el.type !== 'way' && el.type !== 'relation')) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (tags.golf === 'driving_range' || OSM_NOISE_NAME.test(name)) return null;
  return {
    ...NO_DETAILS,
    external_source: 'osm',
    external_id: `${el.type}/${el.id}`,
    name: tidyCourseName(name),
    club_name: null,
    city: nullIfUnknown(tags['addr:city']),
    region: nullIfUnknown(tags['addr:province'] ?? tags['addr:state']),
    country: nullIfUnknown(tags['addr:country']),
    total_par: null,
    holes_count: /^\d+$/.test(tags.holes ?? '') ? Number(tags.holes) : null,
    hole_data: null,
    course_rating: {},
    slope_rating: {},
    lat: lat!,
    lng: lng!,
    website: nullIfUnknown(tags.website ?? tags['contact:website']),
    phone: nullIfUnknown(tags.phone ?? tags['contact:phone']),
  };
}

// ── Provider fetches ─────────────────────────────────────────────────────────

const openGolfConfigured = () => process.env.GOLF_OPENGOLFAPI_DISABLED !== '1';
const gcaConfigured = () => !!process.env.GOLF_COURSE_API_KEY;

/** Any provider available → the UI may offer "search worldwide". */
export function providersConfigured(): boolean {
  return openGolfConfigured() || gcaConfigured();
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // timeout / network — callers degrade to local results
  }
}

const gcaHeaders = () => ({ Authorization: `Bearer ${process.env.GOLF_COURSE_API_KEY}` });

// ── Upserts ──────────────────────────────────────────────────────────────────

/** ~2 km box in degrees for the cross-source dedupe query. Longitude widens
 *  with latitude; 0.03° is ~2 km at 50°N and smaller nearer the equator —
 *  close enough for "same facility". Exported for the import script. */
export const DEDUPE_BOX = { lat: 0.02, lng: 0.03 };

/** The columns the cross-source dedupe needs from an existing neighbour. */
export interface NearbyRow {
  id: string;
  external_source: CatalogRow['external_source'];
  external_id: string;
  name: string;
  club_name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** Existing rows within ~2 km that share an informative name token — the
 *  same facility under a different source ("Eagle Creek Golf Club" from a
 *  provider vs OSM's "Eagle Creek Golf Course"). Without coords there's
 *  nothing to compare, so no guard (today's behavior). */
async function findNearbyNameMatches(admin: SupabaseClient, row: NewRow): Promise<NearbyRow[]> {
  if (typeof row.lat !== 'number' || typeof row.lng !== 'number') return [];
  const { data } = await admin
    .from('golf_courses')
    .select('id, external_source, external_id, name, club_name, city, region, country')
    .gte('lat', row.lat - DEDUPE_BOX.lat)
    .lte('lat', row.lat + DEDUPE_BOX.lat)
    .gte('lng', row.lng - DEDUPE_BOX.lng)
    .lte('lng', row.lng + DEDUPE_BOX.lng)
    .limit(25);
  return ((data as NearbyRow[] | null) ?? []).filter(
    existing => courseNameScore(row.name, existing.name) > 0
  );
}

export type AdoptionDecision =
  | { action: 'insert' }
  | { action: 'skip' }
  | { action: 'adopt'; target: NearbyRow };

/**
 * What upsertThinRows does with an incoming thin row, given its same-name
 * neighbours. Exported pure for tests.
 *
 * "First row wins" was written for a 68-row catalog. After the worldwide
 * OSM import (28.9k rows WITH coords) it silently shadowed every provider
 * hit: an OSM row can never gain tees/ratings/hole pars (no provider knows
 * its id — see hydrateCourse), so the user picked the OSM row, "details
 * load when selected" loaded nothing, and stroke indexes were unreachable
 * for that course forever. Prod showed 0 provider rows added after the
 * import. Now a provider row meeting an OSM-only neighbour ADOPTS it: the
 * OSM row takes the provider identity (keeping OSM's name, coords and hole
 * geometry — provider coords were 6–22 km off for 3 of 4 probed courses)
 * and hydrates via the provider on next selection.
 *
 * Any non-OSM neighbour means a provider already carries the facility →
 * skip, exactly as before. OSM incoming rows never adopt (import path).
 */
export function adoptionDecision(
  incoming: Pick<NewRow, 'external_source'>,
  matches: NearbyRow[]
): AdoptionDecision {
  if (!matches.length) return { action: 'insert' };
  if (incoming.external_source === 'osm') return { action: 'skip' };
  if (matches.some(m => m.external_source !== 'osm')) return { action: 'skip' };
  return { action: 'adopt', target: matches.find(m => m.external_source === 'osm')! };
}

/** Give an OSM-only row the provider's identity so hydration can fill it.
 *  hydrated_at is cleared so the next selection runs the provider branch
 *  rather than sitting out the 7-day gate. Best-effort: a failure leaves the
 *  OSM row as it was, which is today's behaviour, not a regression. */
async function adoptOsmRow(admin: SupabaseClient, target: NearbyRow, incoming: NewRow): Promise<void> {
  // UNIQUE (external_source, external_id): a provider row inserted BEFORE
  // the import (bad provider coords put it outside the box then, and
  // geocode refinement moved it since) is a genuine duplicate — leave both.
  const { data: existing } = await admin
    .from('golf_courses')
    .select('id')
    .eq('external_source', incoming.external_source)
    .eq('external_id', incoming.external_id)
    .maybeSingle();
  if (existing) {
    console.warn(
      `[course-catalog] dedupe skip (provider row exists): ${incoming.external_source}:${incoming.external_id} "${incoming.name}"`
    );
    return;
  }
  const { error } = await admin
    .from('golf_courses')
    .update({
      external_source: incoming.external_source,
      external_id: incoming.external_id,
      club_name: target.club_name ?? incoming.club_name,
      city: target.city ?? incoming.city,
      region: target.region ?? incoming.region,
      country: target.country ?? incoming.country,
      hydrated_at: null,
    })
    .eq('id', target.id);
  if (error) {
    console.error(`[course-catalog] adopt failed for ${target.id}:`, error.message);
    return;
  }
  console.warn(
    `[course-catalog] adopted osm row ${target.id} "${target.name}" as ${incoming.external_source}:${incoming.external_id}`
  );
}

/** Thin identity rows: insert-if-absent, NEVER overwrite (a hydrated row must
 *  not be clobbered back to thin by a later search), and never a second row
 *  for a facility another source already carries — see adoptionDecision. */
async function upsertThinRows(admin: SupabaseClient, rows: NewRow[]): Promise<void> {
  const kept: NewRow[] = [];
  for (const row of rows) {
    const decision = adoptionDecision(row, await findNearbyNameMatches(admin, row));
    if (decision.action === 'insert') {
      kept.push(row);
    } else if (decision.action === 'adopt') {
      await adoptOsmRow(admin, decision.target, row);
    } else {
      console.warn(`[course-catalog] dedupe skip: ${row.external_source}:${row.external_id} "${row.name}"`);
    }
  }
  if (!kept.length) return;
  await admin
    .from('golf_courses')
    .upsert(kept, { onConflict: 'external_source,external_id', ignoreDuplicates: true });
}

// ── The two provider touchpoints ─────────────────────────────────────────────

/**
 * Explicit "search all courses worldwide": OpenGolfAPI first (free, rich);
 * GolfCourseAPI only when OpenGolfAPI yields under 3 hits (conserves its
 * 50/day budget for non-US queries). Upserts thin rows; the caller re-queries
 * the catalog for the merged view. Returns whether anything was fetched.
 */
export async function globalSearch(admin: SupabaseClient, query: string): Promise<boolean> {
  const q = query.trim();
  if (q.length < 3) return false;
  let fetched = false;
  let openGolfHits = 0;

  if (openGolfConfigured() && (await consumeProviderBudget(admin, 'opengolfapi'))) {
    const data = (await fetchJson(
      `https://api.opengolfapi.org/api/v1/courses/search?q=${encodeURIComponent(q)}`
    )) as { courses?: OpenGolfSummary[] } | null;
    const summaries = data?.courses ?? [];
    openGolfHits = summaries.length;
    if (summaries.length) {
      await upsertThinRows(admin, summaries.map(normalizeOpenGolfSummary));
      fetched = true;
    }
  }

  if (openGolfHits < 3 && gcaConfigured() && (await consumeProviderBudget(admin, 'golfcourseapi'))) {
    const data = (await fetchJson(
      `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`,
      gcaHeaders()
    )) as { courses?: GcaSummary[] } | null;
    const summaries = data?.courses ?? [];
    if (summaries.length) {
      await upsertThinRows(admin, summaries.map(normalizeGcaSummary));
      fetched = true;
    }
  }

  return fetched;
}

/**
 * Hydration on selection: a thin provider row gets one detail call and an
 * in-place UPDATE. Any failure (budget, timeout, bad shape) returns the thin
 * course unchanged — selection must never error on provider weather.
 */
export async function hydrateCourse(admin: SupabaseClient, row: CatalogRow): Promise<GolfCourse> {
  if (row.external_source === 'seed') return rowToCourse(row);
  // hydrated_at gates on ATTEMPTED, not on how much data came back: a course
  // whose provider detail is genuinely empty used to look thin forever and
  // re-fetched on every selection. One attempt per 7 days. (Also lets rows
  // hydrated before the details columns existed pick them up once.)
  const HYDRATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  if (row.hydrated_at && Date.now() - new Date(row.hydrated_at).getTime() < HYDRATE_TTL_MS) {
    return rowToCourse(row);
  }

  // OSM rows: no provider knows their external ids, and their coords ARE
  // OSM's — forward-geocoding against OSM again is a wasted budget hit. The
  // one thing hydration can add is the location fields (city/region/country)
  // the search ranks on, via one budgeted Nominatim reverse call.
  if (row.external_source === 'osm') {
    let fill: Awaited<ReturnType<typeof reverseGeocodeCourse>> = null;
    if (
      !row.city &&
      typeof row.lat === 'number' &&
      typeof row.lng === 'number' &&
      (await consumeProviderBudget(admin, 'nominatim'))
    ) {
      fill = await reverseGeocodeCourse(row.lat, row.lng);
    }
    await admin
      .from('golf_courses')
      .update({
        hydrated_at: new Date().toISOString(),
        ...(fill
          ? {
              city: row.city ?? fill.city,
              region: row.region ?? fill.region,
              country: row.country ?? fill.country,
            }
          : {}),
      })
      .eq('id', row.id);
    return rowToCourse(
      fill
        ? {
            ...row,
            city: row.city ?? fill.city,
            region: row.region ?? fill.region,
            country: row.country ?? fill.country,
          }
        : row
    );
  }

  let normalized: NewRow | null = null;
  if (row.external_source === 'opengolfapi' && openGolfConfigured()) {
    if (await consumeProviderBudget(admin, 'opengolfapi')) {
      const data = (await fetchJson(
        `https://api.opengolfapi.org/api/v1/courses/${encodeURIComponent(row.external_id)}`
      )) as OpenGolfDetail | null;
      if (data?.id) normalized = normalizeOpenGolfDetail(data);
    }
  } else if (row.external_source === 'golfcourseapi' && gcaConfigured()) {
    if (await consumeProviderBudget(admin, 'golfcourseapi')) {
      // LIVE shape: detail nests under `course` (the published spec says bare).
      const data = (await fetchJson(
        `https://api.golfcourseapi.com/v1/courses/${encodeURIComponent(row.external_id)}`,
        gcaHeaders()
      )) as { course?: GcaDetail } | null;
      if (data?.course?.id) normalized = normalizeGcaDetail(data.course);
    }
  }

  // Coord refinement runs on BOTH hydration outcomes: provider lat/lng is
  // demonstrably unreliable (real-device report: 3 of 4 courses 8–22 km off),
  // and OSM's golf_course features are the better source. Budgeted like the
  // providers; a null result always keeps the coords we have.
  const refineCoords = async (
    name: string,
    city: string | null,
    region: string | null,
    stored: { lat: number | null; lng: number | null }
  ): Promise<{ lat: number; lng: number } | null> => {
    if (!(await consumeProviderBudget(admin, 'nominatim'))) return null;
    const found = await geocodeGolfCourse(name, city, region);
    if (!found) return null;
    const storedPoint = { lat: stored.lat ?? undefined, lng: stored.lng ?? undefined };
    // acceptGeocode guards bare-name same-name-elsewhere matches; then only
    // replace when the stored coords are actually wrong (>1.5 km).
    if (!acceptGeocode(storedPoint, found)) return null;
    return shouldReplaceCoords(storedPoint, found) ? { lat: found.lat, lng: found.lng } : null;
  };

  if (!normalized) {
    // Attempt happened (or budget/config refused it — cheap either way):
    // stamp so the next selections don't hammer the provider.
    const refined = await refineCoords(row.name, row.city, row.region, row);
    await admin
      .from('golf_courses')
      .update({
        hydrated_at: new Date().toISOString(),
        ...(refined ? { lat: refined.lat, lng: refined.lng } : {}),
      })
      .eq('id', row.id);
    return rowToCourse(refined ? { ...row, lat: refined.lat, lng: refined.lng } : row);
  }

  const providerCoords = {
    lat: normalized.lat ?? row.lat,
    lng: normalized.lng ?? row.lng,
  };
  const refined = await refineCoords(
    normalized.name,
    normalized.city,
    normalized.region,
    providerCoords
  );

  const { data: updated } = await admin
    .from('golf_courses')
    .update({
      name: normalized.name,
      club_name: normalized.club_name,
      city: normalized.city,
      region: normalized.region,
      country: normalized.country,
      total_par: normalized.total_par,
      holes_count: normalized.holes_count,
      hole_data: normalized.hole_data,
      course_rating: normalized.course_rating,
      slope_rating: normalized.slope_rating,
      lat: refined?.lat ?? providerCoords.lat,
      lng: refined?.lng ?? providerCoords.lng,
      description: normalized.description,
      description_attribution: normalized.description_attribution,
      architect: normalized.architect,
      year_built: normalized.year_built,
      course_type: normalized.course_type,
      website: normalized.website,
      phone: normalized.phone,
      hydrated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select(CATALOG_ROW_COLUMNS)
    .maybeSingle();

  return rowToCourse((updated as unknown as CatalogRow) ?? row);
}
