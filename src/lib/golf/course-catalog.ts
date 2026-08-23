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
import { acceptGeocode, geocodeGolfCourse, shouldReplaceCoords } from '@/lib/golf/geocode';

export const OPENGOLF_ATTRIBUTION =
  'Course data © OpenStreetMap contributors (ODbL) via OpenGolfAPI';

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROVIDER_TIMEOUT_MS = 5000;

// ── Catalog row ──────────────────────────────────────────────────────────────

export interface CatalogRow {
  id: string;
  external_source: 'seed' | 'opengolfapi' | 'golfcourseapi';
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

/** Substring matching from 2 chars here (vs the app-wide 3): golf_courses is
 *  a narrow table of dozens–thousands of rows, not golf_rounds — the "%a%
 *  matches every round ever" rationale doesn't apply, and course names are
 *  routinely found by 2-char starts ("st", "pe"). */
const COURSE_WIDE_MATCH_MIN_CHARS = 2;

function coursePattern(q: string): string {
  // PostgREST .or() is comma/paren-delimited and escapeLikePattern doesn't
  // cover those — strip them so a pasted "Club, The (North)" can't corrupt
  // the filter. Also escape LIKE wildcards.
  const safe = q.replace(/[,()]/g, ' ').replace(/[%_\\]/g, m => `\\${m}`).trim();
  return q.length < COURSE_WIDE_MATCH_MIN_CHARS ? `${safe}%` : `%${safe}%`;
}

export async function searchCatalog(
  admin: SupabaseClient,
  query: string,
  limit: number
): Promise<GolfCourse[]> {
  const q = query.trim();
  const builder = admin.from('golf_courses').select(CATALOG_ROW_COLUMNS);
  // name+club+city+region, ordered: without .order() Postgres returns an
  // ARBITRARY window that the rank ladder can only shuffle — with provider
  // rows in the table, seeds could vanish from their own results.
  const p = coursePattern(q);
  const { data, error } = q
    ? await builder
        .or(`name.ilike.${p},club_name.ilike.${p},city.ilike.${p},region.ilike.${p}`)
        .order('name')
        .limit(limit * 5)
    : await builder.order('name').limit(limit); // empty query = browse head
  if (error || !data) return [];
  const rows = data as unknown as CatalogRow[];
  return rows
    .map(row => ({ row, rank: rankCourseFields(row, q) }))
    .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map(({ row }) => rowToCourse(row));
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

/** Thin identity rows: insert-if-absent, NEVER overwrite (a hydrated row must
 *  not be clobbered back to thin by a later search). */
async function upsertThinRows(admin: SupabaseClient, rows: NewRow[]): Promise<void> {
  if (!rows.length) return;
  await admin
    .from('golf_courses')
    .upsert(rows, { onConflict: 'external_source,external_id', ignoreDuplicates: true });
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
