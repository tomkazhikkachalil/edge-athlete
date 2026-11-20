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
import { reportRouteWarning } from '@/lib/observability/report';
import { hitDailyBudget as hitBudget } from '@/lib/provider-budget-server';
import type { GolfCourse, CourseHole } from '@/types/golf';
import { tidyCourseName, courseDisplayName } from '@/lib/golf/tees';
import { acceptGeocode, geocodeGolfCourse, reverseGeocodeCourse, shouldReplaceCoords } from '@/lib/golf/geocode';
import { courseNameScore, nameTokens, polylineYards } from '@/lib/golf/hole-geometry';
import { sheetAgreesWithMap, sheetFromGeometry, type MapSheetHole, type MapSheetLine } from '@/lib/golf/map-sheet';
import { createProviderBreaker, hostOf } from '@/lib/golf/provider-breaker';
import { splitUnlinkedClub, type ClubSectionRow } from '@/lib/golf/club-split-server';
import { creditSources, mergeSheets, nineFromCombination, parsFromTees, providersConfirm, sheetComplete, sheetGaps, sheetSelfConsistent, type Sheet, type SheetHole, type SheetSources } from '@/lib/golf/sheet-merge';
import { normalizeCountry, normalizeRegion } from '@/lib/geo/regions';

/** ODbL attribution for the catalog. The OSM line is owed UNCONDITIONALLY —
 *  28.9k rows are OpenStreetMap-sourced directly and render whether or not
 *  any provider is configured; "via OpenGolfAPI" is appended only while that
 *  provider is on (its rows are OSM-derived too). Gating the whole line on
 *  providersConfigured() was a licence gap the moment OSM became a source. */
// GeoNames (CC BY 4.0) supplies city/region/country for the catalog via the
// `places` table (migration 104/105) — attribution is owed wherever those
// fields render, which is every course row.
export const OSM_ATTRIBUTION =
  'Course data © OpenStreetMap contributors (ODbL) · Location data © GeoNames (CC BY 4.0)';
export const OPENGOLF_ATTRIBUTION = `${OSM_ATTRIBUTION}, some via OpenGolfAPI`;
export function catalogAttribution(providersOn: boolean): string {
  return providersOn ? OPENGOLF_ATTRIBUTION : OSM_ATTRIBUTION;
}

// Canonical home is src/lib/uuid.ts (Aug 2026 hardening round); imported AND
// re-exported so this module's many existing importers stay unchanged.
import { UUID_RE } from '@/lib/uuid';
export { UUID_RE };

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
  // Club/section model (migration 125): siblings at a multi-course facility
  // share a club_id; a section row is a playable 18 or an individual nine.
  // Optional (not in CATALOG_ROW_COLUMNS until the picker round deploys
  // AFTER the migration) so pre-125 selects keep parsing.
  club_id?: string | null;
  section_name?: string | null;
  section_kind?: string | null;
  // Location model (migration 104): the shared `places` FK plus ISO codes
  // next to the names, and which writer filled them ('osm' | 'provider' |
  // 'nominatim' | 'gazetteer'). Writers never downgrade a better source.
  place_id: string | null;
  country_code: string | null;
  region_code: string | null;
  location_source: string | null;
  /** Only on search_golf_courses results with a `near` point. */
  distance_km?: number | null;
  match_rank?: number;
}

// club_id/section_name/section_kind ride the select since migration 125 —
// deploys referencing this string REQUIRE 125 to have run (42703 otherwise).
export const CATALOG_ROW_COLUMNS =
  'id, external_source, external_id, name, club_name, city, region, country, total_par, holes_count, hole_data, course_rating, slope_rating, lat, lng, description, description_attribution, architect, year_built, course_type, website, phone, hydrated_at, place_id, country_code, region_code, location_source, club_id, section_name, section_kind';

/** Ranked, location-aware search options (migration 104's RPC). */
export interface CatalogSearchOptions {
  countryCode?: string;
  regionCode?: string;
  near?: { lat: number; lng: number };
  radiusKm?: number;
}

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
    countryCode: row.country_code ?? undefined,
    regionCode: row.region_code ?? undefined,
    distanceKm: typeof row.distance_km === 'number' ? Math.round(row.distance_km * 10) / 10 : undefined,
    hydratedAt: row.hydrated_at ?? undefined,
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
    phone: row.phone ?? undefined,
    placeId: row.place_id ?? undefined,
    // Undefined until migration 125's columns ride the select.
    clubId: row.club_id ?? undefined,
    clubName: row.club_name ?? undefined,
    sectionName: row.section_name ?? undefined,
    sectionKind: row.section_kind ?? undefined,
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

// courseDisplayName lives in the pure tees module (client-safe) since phase
// 6b A1; re-exported here so the server callers keep their import.
export { courseDisplayName } from '@/lib/golf/tees';

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
  limit: number,
  opts: CatalogSearchOptions = {}
): Promise<GolfCourse[]> {
  const q = query.trim();
  // Migration 104's RPC: every token must match somewhere (name, club,
  // city, region, country — accent-folded, prefix on each token), the whole
  // match set ranked in SQL, location filters and near-me sorting built in.
  const { data, error } = await admin.rpc('search_golf_courses', {
    q,
    max_results: limit,
    p_country_code: opts.countryCode ?? null,
    p_region_code: opts.regionCode ?? null,
    p_near_lat: opts.near?.lat ?? null,
    p_near_lng: opts.near?.lng ?? null,
    p_radius_km: opts.radiusKm ?? null,
  });
  if (!error) return ((data ?? []) as CatalogRow[]).map(rowToCourse);
  const code = (error as { code?: string }).code;
  if (code === '42883' || code === 'PGRST202') {
    // The people-server.ts pattern: code deployed before the migration ran
    // degrades to the pre-104 search and shouts, rather than taking the
    // picker down. Location filters are ignored on this path.
    console.error(
      '[course-catalog] search_golf_courses is missing — MIGRATION 104 HAS NOT BEEN RUN. ' +
        'Serving the pre-104 two-pass search. Run database/migrations/104_places_and_course_search.sql.'
    );
    return searchCatalogFallback(admin, q, limit);
  }
  console.error('[course-catalog] search_golf_courses failed:', error.message);
  return [];
}

/** Country → region facet counts for the Explore filters (104 RPC). Empty
 *  until the migration runs — a missing RPC is a designed empty state. */
export async function courseLocationFacets(
  admin: SupabaseClient,
  countryCode: string | null
): Promise<{ country: string | null; countryCode: string; region: string | null; regionCode: string | null; count: number }[]> {
  const { data, error } = await admin.rpc('golf_course_location_facets', {
    p_country_code: countryCode,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42883' && code !== 'PGRST202') console.error('[course-catalog] facets failed:', error.message);
    return [];
  }
  return ((data ?? []) as { country: string | null; country_code: string; region: string | null; region_code: string | null; n: number }[]).map(
    f => ({ country: f.country, countryCode: f.country_code, region: f.region, regionCode: f.region_code, count: Number(f.n) })
  );
}

/** The pre-104 search, kept verbatim as the degraded path. */
async function searchCatalogFallback(admin: SupabaseClient, q: string, limit: number): Promise<GolfCourse[]> {
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
      .or(`name.ilike.${p},club_name.ilike.${p},city.ilike.${p},region.ilike.${p}`)  // hardening-ok: likeSafe via coursePattern
      .limit(limit * 5),
  ]);
  if (prefix.error && wide.error) return [];
  const rows = [...(prefix.data ?? []), ...(wide.data ?? [])] as unknown as CatalogRow[];
  return mergeSearchRows(rows, q, limit).map(rowToCourse);
}

/** A course with no provider card takes its card from its CACHED map lines
 *  (map-sheet.ts). Read-time only: nothing is written, nothing external is
 *  called, and a provider card always wins.
 *  TAGGED pars only: this is what the guards compare a provider's card with
 *  (findOfficialSheet, the background fill), and an estimate is never evidence. */
export async function readMapSheet(admin: SupabaseClient, id: string): Promise<MapSheetHole[] | null> {
  return (await readMapSheets(admin, id)).tagged;
}

const measureLine = (line: ReadonlyArray<readonly [number, number]>) => polylineYards(line as [number, number][]) ?? 0;

/** One read of the lines, both cards: the tagged one, and (only when there is
 *  no tagged one) the one with missing pars estimated from length. */
async function readMapSheets(admin: SupabaseClient, id: string): Promise<{ tagged: MapSheetHole[] | null; estimated: MapSheetHole[] | null }> {
  const { data } = await admin.from('golf_courses').select('hole_geometry').eq('id', id).maybeSingle();
  const geometry = (data as { hole_geometry?: { holes?: MapSheetLine[] } | null } | null)?.hole_geometry;
  const tagged = sheetFromGeometry(geometry?.holes, measureLine);
  return { tagged, estimated: tagged ? null : sheetFromGeometry(geometry?.holes, measureLine, { estimate: true }) };
}

/** The card's credits (313), read by a writer just before it writes: the column
 *  is NOT in CATALOG_ROW_COLUMNS (that list feeds the pickers and the search
 *  function and must not grow). `undefined` = the column could not be read (a
 *  database without 313): the writer then leaves it out and the card still saves. */
export async function readSheetSources(admin: SupabaseClient, id: string): Promise<SheetSources | null | undefined> {
  const { data, error } = await admin.from('golf_courses').select('sheet_sources').eq('id', id).maybeSingle();
  if (error) return undefined;
  return (data as { sheet_sources?: SheetSources | null } | null)?.sheet_sources ?? null;
}

export async function withMapSheet(admin: SupabaseClient, course: GolfCourse): Promise<GolfCourse> {
  if (course.holes.length > 0 || !UUID_RE.test(course.id)) return course;
  const { tagged, estimated } = await readMapSheets(admin, course.id);
  const holes = tagged ?? estimated;
  if (!holes) return course;
  return { ...course, holes, totalPar: holes.reduce((s, h) => s + h.par, 0), holesCount: holes.length, sheetSource: tagged ? 'map' : 'map_estimated' };
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
  // OpenGolfAPI's published limit is 1,000 a day without a key and 10,000 with
  // its free one: raise this only together with a key.
  opengolfapi: Number(process.env.GOLF_OPENGOLFAPI_DAILY_BUDGET) || 1000,
  // The scorecard fill (Nov 17 2026): its OWN cap, spent BEFORE the shared
  // opengolfapi key, so the background fill always leaves room for a pick.
  'card-fill': Number(process.env.GOLF_CARD_FILL_DAILY_BUDGET) || 800,
  golfcourseapi: Number(process.env.GOLF_PROVIDER_DAILY_BUDGET) || 45,
  // The website scorecard reader (Nov 18 2026): course-site visits a day. No
  // provider is called; the cap is manners (a full pass takes about three weeks).
  'site-card': 600,
  // GolfCourseAPI v1.3.0 `/v1/proximity` (Pro/Enterprise only, Oct 2026):
  // its OWN cap, consumed BEFORE the shared golfcourseapi key, so a burst of
  // "near me" taps can never starve hydration-on-selection (the more
  // valuable spend). Raise GOLF_PROVIDER_DAILY_BUDGET on Pro (10k/day cap).
  'golfcourseapi-proximity': Number(process.env.GOLF_PROXIMITY_DAILY_BUDGET) || 500,
  // Nominatim coord refinement — one call per course per hydration (7-day
  // TTL), so this is headroom, not a target. Policy compliance lives in
  // geocode.ts (UA, never per-keystroke).
  nominatim: 500,
  // Overpass hole-geometry fetches — one per course per 30 days (cached in
  // hole_geometry_at). Etiquette lives in hole-geometry.ts.
  overpass: 200,
  // Open-Meteo elevation profiles (254) — two requests per course per 30
  // days (180 sampled coordinates, 100 per request); 100/day ≈ 50 courses.
  'open-meteo': 100,
  // T2: one hit per COURSE per 30 days (1–4 free tile reads behind it).
  'terrain-tiles': 400,
  // Map sweep PR 6 — its OWN keys, so the sweep never starves a live map
  // open: one regional Overpass query per CELL (≈15 % of Overpass's ~10k/day
  // fair use at one in flight with 3 s gaps; ~4,500 cells in ~3 days, ~160
  // a day at steady state), and one terrain hit per course (≤ 4 S3 reads).
  'sweep-overpass': 1500,
  'sweep-terrain': 3000,
};

// The daily budget hit itself lives in src/lib/provider-budget-server.ts
// (Oct 29 2026) — the weather needed it with an owner that is not golf.

/** Exported for the hole-geometry cache (same budget machinery, its own key). */
export async function consumeProviderBudget(admin: SupabaseClient, source: string): Promise<boolean> {
  return hitBudget(admin, `golf-provider:${source}`, DEFAULT_BUDGETS[source] ?? 45);
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
  place_id: null,
} as const;

/** Every writer's location fields, normalized once: names AND ISO codes so
 *  search matches what people type ("Florida", "Canada", "FL", "CA").
 *  `source` is recorded only when something was actually known. */
function locationFields(
  countryRaw: string | null | undefined,
  regionRaw: string | null | undefined,
  source: 'provider' | 'osm'
): Pick<NewRow, 'country' | 'country_code' | 'region' | 'region_code' | 'location_source'> {
  const country = normalizeCountry(countryRaw);
  const region = normalizeRegion(regionRaw, country?.code);
  return {
    country: country?.name ?? nullIfUnknown(countryRaw),
    country_code: country?.code ?? null,
    region: region?.name ?? null,
    region_code: region?.code ?? null,
    location_source: country || region ? source : null,
  };
}

export function normalizeOpenGolfSummary(s: OpenGolfSummary): NewRow {
  return {
    ...NO_DETAILS,
    external_source: 'opengolfapi',
    external_id: s.id,
    name: tidyCourseName(s.course_name),
    club_name: null,
    city: nullIfUnknown(s.city),
    ...locationFields(s.country_iso, s.state, 'provider'),
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
    ...locationFields(nullIfUnknown(d.country_iso) ?? 'US', d.state, 'provider'),
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

/** `/v1/proximity` (v1.3.0): a search summary PLUS the course's coordinates
 *  and its distance from the point asked about — the first GolfCourseAPI
 *  payload that carries coordinates at all. */
export interface GcaProximityCourse extends GcaSummary {
  location?: (NonNullable<GcaSummary['location']> & { latitude?: number | string | null; longitude?: number | string | null }) | null;
  distance?: number | string | null;
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
    ...locationFields(s.location?.country, s.location?.state, 'provider'),
    total_par: null,
    holes_count: null,
    hole_data: null,
    course_rating: {},
    slope_rating: {},
    lat: null,
    lng: null,
  };
}

const finiteOrNull = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** A proximity hit → a thin row WITH coordinates (both finite, else null —
 *  a bad payload stays thin rather than wrong) and the distance we asked for
 *  in km (`unit=km` is always requested). */
export function normalizeGcaProximity(s: GcaProximityCourse): NewRow & { distanceKm: number | null } {
  const lat = finiteOrNull(s.location?.latitude);
  const lng = finiteOrNull(s.location?.longitude);
  const both = lat !== null && lng !== null;
  return {
    ...normalizeGcaSummary(s),
    lat: both ? lat : null,
    lng: both ? lng : null,
    distanceKm: finiteOrNull(s.distance),
  };
}

/** Holes on which GolfCourseAPI's tee boxes of one length gave different pars. */
export function gcaParsDisputed(d: GcaDetail): number[] {
  const boxes = [...(d.tees?.male ?? []), ...(d.tees?.female ?? [])];
  const most = boxes.reduce((n, t) => Math.max(n, t.holes?.length ?? 0), 0);
  if (most === 0) return [];
  return parsFromTees(boxes.filter(b => b.holes?.length === most).map(b => (b.holes ?? []).map(x => x.par))).disputed;
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
  const sameCount = boxes.filter(b => b.holes?.length === refHoles.length);
  // Nov 16 2026: a women's box named like a men's one keeps its yardages under
  // the same "(f)" key its rating and slope already use (they were dropped).
  const maleKeys = new Set(male.map(t => (t.tee_name ?? '').toLowerCase().trim()));
  const yardageKey = (box: GcaTeeBox): string => {
    const key = (box.tee_name ?? '').toLowerCase().trim();
    return key && female.includes(box) && maleKeys.has(key) ? `${key} (f)` : key;
  };
  // Nov 20 2026: the pars are the card most boxes share, not the first box's
  // (parsFromTees: Angus Glen South's Black tee alone said hole 1 is a par 5).
  const taken = parsFromTees(sameCount.map(b => (b.holes ?? []).map(x => x.par)), Math.max(0, reference ? sameCount.indexOf(reference) : 0));
  const built = refHoles.map((h, i) => {
    const yardage: Record<string, number> = {};
    for (const box of sameCount) {
      const key = yardageKey(box);
      const y = box.holes?.[i]?.yardage;
      if (key && y != null && !(key in yardage)) yardage[key] = y;
    }
    // Nov 16 2026: a par the reference box lacks comes from another box of the
    // same course, and a stroke index likewise. Never a guessed 4.
    const par = taken.pars[i] ?? null;
    const handicap = h.handicap || sameCount.map(b => b.holes?.[i]?.handicap).find(v => !!v) || 0;
    return { number: i + 1, par, yardage, handicap };
  });
  // A hole no box knows the par of: this is not a card (the caller reports no_tees).
  const holes: CourseHole[] = built.every(h => h.par != null) ? (built as CourseHole[]) : [];

  const base = normalizeGcaSummary(d);
  return {
    ...base,
    // The stated total of the box whose card was taken.
    total_par: sameCount[taken.from]?.par_total ?? reference?.par_total ?? null,
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
    ...locationFields(tags['addr:country'], tags['addr:province'] ?? tags['addr:state'], 'osm'),
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

/** The GolfCourseAPI plan the key is on (Oct 2026). `/v1/proximity` is Pro /
 *  Enterprise only; on Free the endpoint answers an error AND would burn the
 *  45/day budget, so the plan is read BEFORE any budget RPC. Unset or
 *  unrecognised → 'free' (fail closed). */
export type GcaPlan = 'free' | 'pro' | 'enterprise';
export function gcaPlan(): GcaPlan {
  const v = (process.env.GOLF_COURSE_API_PLAN ?? '').trim().toLowerCase();
  return v === 'pro' || v === 'enterprise' ? v : 'free';
}
/** May the proximity endpoint be called at all? A key AND a paid plan. */
export function proximityAllowed(): boolean {
  return gcaConfigured() && gcaPlan() !== 'free';
}

/** Any provider available → the UI may offer "search worldwide". */
export function providersConfigured(): boolean {
  return openGolfConfigured() || gcaConfigured();
}

/** What a provider call came back with (H1): the body, or WHY not — the
 *  HTTP status, a timeout, or a network error. `fetchJson` below keeps its
 *  null-on-anything contract for the callers that only degrade. */
export type FetchJsonResult = { ok: true; body: unknown } | { ok: false; status: number | 'timeout' | 'network' | 'down' };

/** Which provider hosts just failed (provider-breaker.ts): a host in trouble
 *  is answered `down` at once for a few minutes, not waited on by every pick. */
const providerBreaker = createProviderBreaker();
/** True while calls to this provider's host are being skipped. */
export function providerHostDown(url: string): boolean {
  return providerBreaker.isDown(hostOf(url));
}
/** Tests only: forget every host's state. */
export function resetProviderBreakerForTests(): void {
  for (const host of Object.keys(providerBreaker.snapshot())) providerBreaker.record(host, 'ok');
}

async function fetchJsonResult(url: string, headers?: Record<string, string>): Promise<FetchJsonResult> {
  const host = hostOf(url);
  if (providerBreaker.isDown(host)) return { ok: false, status: 'down' };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!res.ok) {
      // A 404 is an answer; anything else is the provider's trouble and is named.
      if (res.status !== 404) console.warn(`[course-catalog] provider ${host} answered HTTP ${res.status}`);
      providerBreaker.record(host, res.status);
      return { ok: false, status: res.status };
    }
    const body = await res.json();
    providerBreaker.record(host, 'ok');
    return { ok: true, body };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    const status = /abort|timeout/i.test(name) ? 'timeout' : 'network';
    providerBreaker.record(host, status);
    return { ok: false, status };
  }
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  const r = await fetchJsonResult(url, headers);
  return r.ok ? r.body : null; // timeout / network / non-2xx — callers degrade to local results
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

/** Strict name identity for the COORD-LESS dedupe: one name's informative
 *  tokens must all appear in the other's ("Kahkwa Club" ⊂ "The Kahkwa
 *  Club"). A 2 km box can afford a single shared token; a whole city
 *  cannot — "Ottawa Hunt" and "Ottawa Valley" share "ottawa" and are
 *  different clubs. courseNameScore(a, a) is a's informative token count,
 *  so subset ⇔ score(a,b) equals the smaller self-score. Exported pure. */
export function sameFacilityName(a: string, b: string): boolean {
  const shared = courseNameScore(a, b);
  if (shared === 0) return false;
  return shared === Math.min(courseNameScore(a, a), courseNameScore(b, b));
}

const NEARBY_COLUMNS = 'id, external_source, external_id, name, club_name, city, region, country';

/** Existing rows that are the same facility under a different source
 *  ("Eagle Creek Golf Club" from a provider vs OSM's "Eagle Creek Golf
 *  Course"). With coords: within ~2 km sharing an informative name token.
 *  Without coords (GolfCourseAPI summaries carry none — the asymmetry that
 *  let "The Kahkwa Club" land beside the just-adopted "Kahkwa Club", prod
 *  Aug 24): same city AND a strict subset name match. No coords and no
 *  city: nothing to compare, no guard. */
async function findNearbyNameMatches(admin: SupabaseClient, row: NewRow): Promise<NearbyRow[]> {
  if (typeof row.lat === 'number' && typeof row.lng === 'number') {
    const { data } = await admin
      .from('golf_courses')
      .select(NEARBY_COLUMNS)
      .gte('lat', row.lat - DEDUPE_BOX.lat)
      .lte('lat', row.lat + DEDUPE_BOX.lat)
      .gte('lng', row.lng - DEDUPE_BOX.lng)
      .lte('lng', row.lng + DEDUPE_BOX.lng)
      .limit(25);
    return ((data as NearbyRow[] | null) ?? []).filter(
      existing => courseNameScore(row.name, existing.name) > 0
    );
  }
  const city = (row.city ?? '').trim();
  if (!city) return [];
  const { data } = await admin
    .from('golf_courses')
    .select(NEARBY_COLUMNS)
    .ilike('city', city.replace(/[%_\\]/g, m => `\\${m}`))
    .limit(50);
  return ((data as NearbyRow[] | null) ?? []).filter(existing => sameFacilityName(row.name, existing.name));
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
      // Codes travel with the names they came from.
      ...(target.region ? {} : { region_code: incoming.region_code }),
      ...(target.country ? {} : { country_code: incoming.country_code }),
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

  // A host that just failed is not asked and not charged for (provider-breaker.ts).
  if (openGolfConfigured() && !providerHostDown('https://api.opengolfapi.org/') && (await consumeProviderBudget(admin, 'opengolfapi'))) {
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

  if (openGolfHits < 3 && gcaConfigured() && !providerHostDown('https://api.golfcourseapi.com/') && (await consumeProviderBudget(admin, 'golfcourseapi'))) {
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

// ── "Find the official scorecard" (Oct 31 2026) ─────────────────────────────
// Tom, on The Marshes: a catalog row can sit WITHOUT a tee sheet for good —
// a thin provider row whose own provider's detail came back empty (stamped,
// never re-asked), or a map-only OSM row (no provider knows its id). The
// other provider may still carry the sheet under the course's NAME. On a
// deliberate tap the row asks GolfCourseAPI by name and, when exactly one
// same-facility candidate agrees on country / region (and city when it has
// to decide between several), its detail's pars, handicaps, tee yardages
// and ratings are written onto THIS row — the identity, coords and source
// stay (the adopt rule's spirit: the sheet joins the row people pick).
// Never a guess: two candidates that both fit is "no match".

export interface SheetCandidate {
  id: string;
  name: string;
  city: string | null;
  region_code: string | null;
  country_code: string | null;
  /** What the provider's SEARCH already says about where the course is and how
   *  long it is (Nov 19 2026): both providers return coordinates, OpenGolfAPI a
   *  par and a hole count too. Used only to tell candidates apart. */
  lat?: number | null;
  lng?: number | null;
  par?: number | null;
  holes?: number | null;
  /** Other listings of the SAME course (same name, same point): the provider
   *  holds it twice. Tried in turn when this one has no holes. */
  twins?: string[];
}

/** What to ask the provider: the course's distinctive words. Its search finds
 *  "Camelot" and returns nothing for "Camelot Golf & Country Club" (Oct 31 2026:
 *  full names made nearly every lookup a miss). Pure. */
export function sheetSearchQuery(name: string): string {
  const core = [...nameTokens(name)].join(' ');
  return core || name;
}

/** A name without its section: "Ottawa Hunt and Golf Club (North Nine)" and
 *  "Rockland Golf Club - East" → the club's own name. Pure. */
export function sectionlessName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+[-–—]\s+.*$/, '').trim();
}

/** At most this many searches for one course and one provider. */
export const SHEET_SEARCH_MAX = 3;

/** The searches to try, in order, until one returns something. The providers'
 *  search answers NOTHING for words they do not hold (measured Nov 18 2026 on
 *  Tom's own courses: "ottawa hunt north nine" 0, "ottawa hunt" 1;
 *  "greensmere legacy" 0, "greensmere" 1; "carleton yacht" 0, "carleton" 3).
 *  So: the distinctive words; then the name without its section ("(North
 *  Nine)", "- East"); then fewer words from the end. A wider search only
 *  FINDS candidates: pickSheetCandidate still decides, on the name and the
 *  place. Pure. */
export function sheetSearchQueries(name: string): string[] {
  const out: string[] = [];
  const add = (q: string) => { if (q && !out.includes(q)) out.push(q); };
  add(sheetSearchQuery(name));
  const base = sectionlessName(name);
  if (base && base !== name) add([...nameTokens(base)].join(' '));
  const words = (out[out.length - 1] ?? '').split(' ').filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) add(words.slice(0, n).join(' '));
  return out.slice(0, SHEET_SEARCH_MAX);
}

/** Words in a section's name that say nothing about WHICH section it is. */
const SECTION_GENERIC = new Set(['nine', 'eighteen', 'course', 'holes', 'hole', '9', '18']);

/** At most this many sibling listings are asked for to confirm a nine. */
export const NINE_SIBLINGS_MAX = 3;

/** Two listings closer than this are the same place (the providers repeat a
 *  club's own address for each of its listings, to the metre). */
export const SHEET_TWIN_KM = 0.2;
/** A candidate this close to the row is "at" the row (card-fill's link rule). */
export const SHEET_NEAR_KM = 2;

function sheetKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const located = (c: { lat?: number | null; lng?: number | null }): c is { lat: number; lng: number } =>
  typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng);

/** A section's word in a candidate's words. The same word, or the same word
 *  spelled with one more letter at the end, on a long word only (measured
 *  Nov 19 2026: our "Premier" is GolfCourseAPI's "Premiere"). Never "north"
 *  for "south": two different words are two different sections. */
export function sectionWordIn(theirs: ReadonlySet<string>, word: string): boolean {
  if (theirs.has(word)) return true;
  if (word.length < 6) return false;
  for (const t of theirs) {
    const [short, long] = t.length < word.length ? [t, word] : [word, t];
    if (short.length >= 6 && long.length === short.length + 1 && long.startsWith(short)) return true;
  }
  return false;
}

/** The row's section words, and the candidates that carry this facility's name
 *  (`sameName`) and, of those, its section (`named`). Pure. */
function sheetNamed(
  row: Pick<CatalogRow, 'name'> & { section_name?: string | null },
  candidates: SheetCandidate[]
): { sameName: SheetCandidate[]; named: SheetCandidate[] } {
  // A SECTION of a club (Greensmere's Legacy, Ottawa Hunt's North Nine) takes
  // only a candidate that names that section: the club's own card, or a
  // sibling's, on this row would be a wrong card under the right club name.
  // The section is the row's `section_name`, or, on a row that has none, what
  // its NAME carries after the club's ("Rockland Golf Club - East": measured
  // Nov 18 2026, the widened search found the club and its other nines for it).
  const base = nameTokens(sectionlessName(row.name));
  const fromName = [...nameTokens(row.name)].filter(t => !base.has(t));
  const section = (row.section_name ? [...nameTokens(row.section_name)] : fromName).filter(t => !SECTION_GENERIC.has(t));
  // The FACILITY's name: for a section row, the club's (so a sibling section,
  // or a section spelled a letter apart, still counts as this facility).
  const club = sectionlessName(row.name);
  const sameName = candidates.filter(c => sameFacilityName(row.name, c.name) || (section.length > 0 && sameFacilityName(club, sectionlessName(c.name))));
  const named = section.length === 0 ? sameName : sameName.filter(c => { const theirs = nameTokens(c.name); return section.every(t => sectionWordIn(theirs, t)); });
  return { sameName, named };
}

/** Why no candidate was picked, for the trace: nothing found, nothing with the
 *  facility's name, nothing naming this row's section, or a real tie. Pure. */
export function sheetMissReason(
  row: Pick<CatalogRow, 'name'> & { section_name?: string | null },
  candidates: SheetCandidate[]
): 'no_candidates' | 'no_name_match' | 'no_section_match' | 'not_narrowed' {
  if (candidates.length === 0) return 'no_candidates';
  const { sameName, named } = sheetNamed(row, candidates);
  if (sameName.length === 0) return 'no_name_match';
  return named.length === 0 ? 'no_section_match' : 'not_narrowed';
}

/** Listings of one course folded into one candidate: the same words in the
 *  name and the same point (both located, within SHEET_TWIN_KM). The first
 *  keeps the others' ids as `twins`. Measured Nov 19 2026: GolfCourseAPI holds
 *  Glen Abbey (Oakville) twice, same name, same address, same coordinates, and
 *  two indistinguishable candidates used to mean no card. Pure. */
export function foldSheetTwins(candidates: SheetCandidate[]): SheetCandidate[] {
  const out: SheetCandidate[] = [];
  const words = (c: SheetCandidate) => [...nameTokens(c.name)].sort().join(' ');
  for (const c of candidates) {
    const first = located(c) ? out.find(o => located(o) && words(o) === words(c) && sheetKm(o.lat, o.lng, c.lat, c.lng) <= SHEET_TWIN_KM) : undefined;
    if (first) first.twins = [...(first.twins ?? []), c.id];
    else out.push({ ...c });
  }
  return out;
}

/** At most this many courses are made out of one club's listings. */
export const CLUB_SECTIONS_MAX = 4;

export interface ClubSectionFound {
  /** "North" — the words the listing adds to the club's name. */
  label: string;
  /** The provider listing that names it. */
  id: string;
}

/** A club the provider lists as SEVERAL named courses, on a row of ours that
 *  is the club itself (Nov 19 2026, Tom: split the club into its courses).
 *  Measured: "Angus Glen Golf Club" is one row here; GolfCourseAPI holds
 *  "… – South Course" and "… – North Course" at the club's one address.
 *  Returned only when every listing left after the name and place rules:
 *  carries the club's own name plus one or two words of its own, no two
 *  alike; sits at ONE point (SHEET_TWIN_KM); and that point is the row's
 *  (SHEET_NEAR_KM). Two to CLUB_SECTIONS_MAX of them. A row that is already a
 *  section, a listing that is the club itself, an unlocated listing: null,
 *  and the tie stays a tie. Sections are never invented: each one is a
 *  course the provider names. Pure. */
export function clubSectionsFromCandidates(
  row: Pick<CatalogRow, 'name' | 'city' | 'region_code' | 'country_code'> & { section_name?: string | null; section_kind?: string | null; lat?: number | null; lng?: number | null },
  candidates: SheetCandidate[]
): ClubSectionFound[] | null {
  if (row.section_name || (row.section_kind && row.section_kind !== 'unspecified')) return null;
  if (sectionlessName(row.name) !== row.name.trim() || !located(row)) return null;
  const { named } = sheetNamed(row, candidates);
  const placed = foldSheetTwins(named.filter(
    c =>
      (!row.country_code || !c.country_code || row.country_code === c.country_code) &&
      (!row.region_code || !c.region_code || row.region_code === c.region_code)
  ));
  if (placed.length < 2 || placed.length > CLUB_SECTIONS_MAX) return null;
  const mine = nameTokens(row.name);
  const out: ClubSectionFound[] = [];
  const first = placed[0];
  if (!located(first) || sheetKm(row.lat, row.lng, first.lat, first.lng) > SHEET_NEAR_KM) return null;
  for (const c of placed) {
    if (!located(c) || sheetKm(first.lat, first.lng, c.lat, c.lng) > SHEET_TWIN_KM) return null;
    // The words the listing adds, in the order it writes them.
    const extra = [...nameTokens(c.name)].filter(t => !mine.has(t) && !SECTION_GENERIC.has(t));
    if (extra.length < 1 || extra.length > 2) return null;
    const label = extra.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (out.some(o => o.label === label)) return null;
    out.push({ label, id: c.id });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The one candidate that is this facility, or null. Pure — tests cover it. */
export function pickSheetCandidate(
  row: Pick<CatalogRow, 'name' | 'city' | 'region_code' | 'country_code'> & { section_name?: string | null; lat?: number | null; lng?: number | null; holes_count?: number | null },
  candidates: SheetCandidate[],
  /** The tagged map card's total and length, when the row has one (never an estimate). */
  map?: { par: number; holes: number } | null
): SheetCandidate | null {
  const { named } = sheetNamed(row, candidates);
  const placed = foldSheetTwins(named.filter(
    c =>
      (!row.country_code || !c.country_code || row.country_code === c.country_code) &&
      (!row.region_code || !c.region_code || row.region_code === c.region_code)
  ));
  if (placed.length <= 1) return placed[0] ?? null;
  // Several fit: narrow by what is positively known, never by guessing.
  // A candidate confirmed in the same region beats one with no location…
  const confirmed = placed.filter(c => !!row.region_code && c.region_code === row.region_code);
  const pool = confirmed.length > 0 ? confirmed : placed;
  if (pool.length === 1) return pool[0];
  // …the same distinctive name beats a section of it ("Royal Ottawa" over
  // "Royal Ottawa (Royal Nine)")…
  const want = [...nameTokens(row.name)].sort().join(' ');
  const exact = pool.filter(c => [...nameTokens(c.name)].sort().join(' ') === want);
  if (exact.length === 1) return exact[0];
  // …the city decides between twins…
  const city = (row.city ?? '').trim().toLowerCase();
  const sameCity = city ? pool.filter(c => (c.city ?? '').trim().toLowerCase() === city) : [];
  if (sameCity.length === 1) return sameCity[0];
  // …then what the search itself says (Nov 19 2026), each only when it leaves
  // exactly one: the only candidate AT the row's point, the only one with the
  // row's (or the map's) hole count, the only one with the map's tagged par.
  // Only among candidates whose name adds nothing to the row's: "X – North" is
  // one course OF the club, and being at the club's point does not make it the
  // club's card. Two courses of one club stay tied: a question for the golfer.
  const mine = nameTokens(row.name);
  const plain = pool.filter(c => [...nameTokens(c.name)].every(t => mine.has(t)));
  if (plain.length === 0) return null;
  if (located(row)) {
    const near = plain.filter(c => located(c) && sheetKm(row.lat, row.lng, c.lat, c.lng) <= SHEET_NEAR_KM);
    if (near.length === 1) return near[0];
  }
  const holes = row.holes_count ?? map?.holes ?? null;
  if (holes) {
    const sameHoles = plain.filter(c => c.holes === holes);
    if (sameHoles.length === 1) return sameHoles[0];
  }
  if (map) {
    const samePar = plain.filter(c => c.par === map.par && (c.holes == null || c.holes === map.holes));
    if (samePar.length === 1) return samePar[0];
  }
  return null;
}

export interface OfficialSheetResult {
  found: boolean;
  outcome: 'already' | 'found' | 'split' | 'no_match' | 'map_disagrees' | 'no_sheet' | 'not_configured' | 'budget_refused' | 'provider_error';
  course: GolfCourse;
  /** `split`: the provider lists this club as several courses; the catalog now
   *  holds one row per course and the golfer is asked which one. */
  club?: { id: string; name: string };
  siblings?: ClubSectionRow[];
  /** What each provider asked came to (Nov 18 2026): counts and a reason,
   *  never the provider's data. A miss used to say only "no match", and why
   *  could not be read afterwards (Glen Abbey, Oakville). */
  trace?: SheetAsk[];
}

export interface SheetAsk {
  source: SheetProvider['source'];
  /** What the search returned / how many carry this facility's name / the one picked. */
  /** How many searches were made (the wording is widened when one returns nothing). */
  searches?: number;
  candidates?: number;
  named?: number;
  picked?: string | null;
  /** The card is the front nine of an eighteen, confirmed by a sibling listing. */
  fromCombination?: boolean;
  result: 'filled' | 'nothing_new' | 'no_candidates' | 'no_name_match' | 'no_section_match' | 'not_narrowed' | 'no_holes' | 'wrong_holes' | 'map_disagrees' | 'card_disagrees' | 'budget_refused' | 'provider_error' | 'provider_down';
}

/** One source of official cards (Nov 16 2026). `search` answers the provider's
 *  candidates for a name, `detail` one candidate's card; null is "the provider
 *  had trouble", never "nothing found". A third provider is one more entry in
 *  SHEET_PROVIDERS: its own daily budget in DEFAULT_BUDGETS, its two calls. */
export interface SheetProvider {
  source: 'opengolfapi' | 'golfcourseapi';
  configured(): boolean;
  /** Its host just failed and is being skipped for a few minutes. */
  down(): boolean;
  search(query: string): Promise<SheetCandidate[] | null>;
  /** `parsDisputed`: holes on which the provider's own tee boxes disagreed. */
  detail(id: string): Promise<{ row: NewRow | null; parsDisputed?: number[] } | null>;
}

const candidateOf = (id: string, n: NewRow, at?: { lat: number | null; lng: number | null }): SheetCandidate => {
  const lat = at?.lat ?? n.lat ?? null;
  const lng = at?.lng ?? n.lng ?? null;
  return {
    id,
    name: n.name,
    city: n.city,
    region_code: n.region_code,
    country_code: n.country_code,
    // Both or neither: half a point is no point.
    ...(lat != null && lng != null ? { lat, lng } : {}),
    ...(n.total_par ? { par: n.total_par } : {}),
    ...(n.holes_count ? { holes: n.holes_count } : {}),
  };
};

const openGolfSheets: SheetProvider = {
  source: 'opengolfapi',
  configured: openGolfConfigured,
  down: () => providerHostDown('https://api.opengolfapi.org/'),
  async search(query) {
    const r = await fetchJsonResult(`https://api.opengolfapi.org/api/v1/courses/search?q=${encodeURIComponent(query)}`);
    if (!r.ok) return null;
    return ((r.body as { courses?: OpenGolfSummary[] } | null)?.courses ?? []).map(s => candidateOf(s.id, normalizeOpenGolfSummary(s)));
  },
  async detail(id) {
    const r = await fetchJsonResult(`https://api.opengolfapi.org/api/v1/courses/${encodeURIComponent(id)}`);
    // "Course not found" is an ANSWER (no such course), not a failure: the
    // published file lists ids the API no longer serves (measured Nov 18 2026:
    // two of the Olympic Club Lake Course's three ids answer 404). Read as a
    // failure it was never stamped, and such a row stayed at the head of the
    // fill's queue.
    if (!r.ok) return r.status === 404 ? { row: null } : null;
    const d = r.body as OpenGolfDetail | null;
    return { row: d?.id ? normalizeOpenGolfDetail(d) : null };
  },
};

const gcaSheets: SheetProvider = {
  source: 'golfcourseapi',
  configured: gcaConfigured,
  down: () => providerHostDown('https://api.golfcourseapi.com/'),
  async search(query) {
    const r = await fetchJsonResult(`https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(query)}`, gcaHeaders());
    if (!r.ok) return null;
    // The search answers each course's coordinates (read live Nov 19 2026); the
    // catalog row made from a summary stays thin, the candidate keeps the point.
    return ((r.body as { courses?: GcaProximityCourse[] } | null)?.courses ?? []).map(s =>
      candidateOf(s.id, normalizeGcaSummary(s), { lat: finiteOrNull(s.location?.latitude), lng: finiteOrNull(s.location?.longitude) })
    );
  },
  async detail(id) {
    const r = await fetchJsonResult(`https://api.golfcourseapi.com/v1/courses/${encodeURIComponent(id)}`, gcaHeaders());
    if (!r.ok) return null;
    // LIVE shape: detail nests under `course`.
    const d = (r.body as { course?: GcaDetail } | null)?.course;
    if (!d?.id) return { row: null };
    const disputed = gcaParsDisputed(d);
    return { row: normalizeGcaDetail(d), ...(disputed.length ? { parsDisputed: disputed } : {}) };
  },
};

/** The order they are asked in: the keyless one with the large budget first,
 *  so GolfCourseAPI's 50 a day are spent only on what is still missing. */
export const SHEET_PROVIDERS: ReadonlyArray<SheetProvider> = [openGolfSheets, gcaSheets];

/** How many times a day a course's ask is handed back after a provider's trouble. */
export const SHEET_ASK_RETRIES = 2;

/** True when a lookup that saved nothing met a provider that failed or was
 *  being skipped: the day's ask bought no answer from it. Pure. */
export function sheetAskUnanswered(trace: ReadonlyArray<Pick<SheetAsk, 'result'>>): boolean {
  return trace.some(t => t.result === 'provider_error' || t.result === 'provider_down');
}

/** A provider's trouble is not the course's answer for the day (Nov 20 2026:
 *  Ottawa Hunt's West Nine lost a day to one failed detail call). The ask is
 *  handed back, at most SHEET_ASK_RETRIES times a day per course, so a provider
 *  that stays broken cannot be asked without end. A failure here only leaves
 *  the ask spent, which is the old behaviour. */
async function releaseSheetAsk(admin: SupabaseClient, courseId: string, trace: ReadonlyArray<SheetAsk>): Promise<void> {
  if (!sheetAskUnanswered(trace)) return;
  if (!(await hitBudget(admin, `golf-sheet-retry:${courseId}`, SHEET_ASK_RETRIES))) return;
  try {
    const { error } = await admin.from('rate_limits').delete().eq('key', `golf-sheet-ask:${courseId}`);
    if (error) console.error(`[course-catalog] official sheet: the ask for ${courseId} could not be handed back:`, error.message);
  } catch { /* the ask stays spent */ }
}

/** Only ever for a person who picked this course: the providers' terms allow
 *  caching what serves a user and ban harvesting a copy, so there is no bulk
 *  caller (Oct 31 2026). One ask per course per day, whoever asks.
 *
 *  Nov 16 2026: EVERY provider that is not the row's own is asked by name (the
 *  row's own was asked by id when it was hydrated), until the card lacks
 *  nothing. Each answer fills the card through mergeSheets: a card with pars
 *  from one source takes tees, stroke indexes and ratings from another, and an
 *  answer that disagrees with the card (or with the map card) is refused. */
export async function findOfficialSheet(admin: SupabaseClient, row: CatalogRow): Promise<OfficialSheetResult> {
  const answer = (outcome: OfficialSheetResult['outcome'], r: CatalogRow = row, asked?: SheetAsk[]): OfficialSheetResult => ({
    found: outcome === 'already' || outcome === 'found',
    outcome,
    course: rowToCourse(r),
    ...(asked?.length ? { trace: asked } : {}),
  });
  const hadCard = (row.hole_data?.length ?? 0) > 0;
  /** No answer came: a card the row already holds is still a card. */
  const miss = (outcome: OfficialSheetResult['outcome'], asked?: SheetAsk[]) => answer(hadCard ? 'already' : outcome, row, asked);
  if (sheetComplete(row)) return answer('already');
  // A test row's card is whatever its spec seeded: never topped up from outside.
  if (hadCard && (row.external_source as string) === 'qa-e2e') return answer('already');
  const providers = SHEET_PROVIDERS.filter(p => p.source !== row.external_source && p.configured());
  if (providers.length === 0) return miss('not_configured');
  if (!(await hitBudget(admin, `golf-sheet-ask:${row.id}`, 1))) return miss('no_match');

  // A map card is protected: a wrong same-named course must not replace it.
  const mapSheet = hadCard ? null : await readMapSheet(admin, row.id);
  let card: Sheet = {
    total_par: row.total_par,
    holes_count: row.holes_count,
    hole_data: row.hole_data,
    course_rating: row.course_rating,
    slope_rating: row.slope_rating,
  };
  const from: string[] = [];
  const trace: SheetAsk[] = [];
  /** Answers refused for disagreeing with the map card. */
  const against: Array<{ source: SheetProvider['source']; id: string; sheet: Sheet }> = [];
  // Read only when something is about to be written (the loop's first fill).
  let sources: SheetSources | null | undefined;
  let why: OfficialSheetResult['outcome'] = 'no_match';
  /** A tie that is really a club's several courses (clubSectionsFromCandidates). */
  let splitFound: ClubSectionFound[] | null = null;
  for (const provider of providers) {
    if (sheetComplete(card)) break;
    const ask: SheetAsk = { source: provider.source, result: 'provider_error' };
    trace.push(ask);
    // A provider whose host just failed is not asked, and not charged for.
    if (provider.down()) { why = 'provider_error'; ask.result = 'provider_down'; continue; }
    if (!(await consumeProviderBudget(admin, provider.source))) { why = 'budget_refused'; ask.result = 'budget_refused'; continue; }
    // The searches in order, each one budgeted, until one returns something.
    let candidates: SheetCandidate[] | null = [];
    let refused = false;
    const queries = sheetSearchQueries(row.name);
    for (let q = 0; q < queries.length; q++) {
      if (q > 0 && !(await consumeProviderBudget(admin, provider.source))) { refused = true; break; }
      candidates = await provider.search(queries[q]);
      ask.searches = q + 1;
      if (!candidates || candidates.length > 0) break;
    }
    if (refused && !candidates?.length) { why = 'budget_refused'; ask.result = 'budget_refused'; continue; }
    if (!candidates) { why = 'provider_error'; continue; }
    const mapFacts = mapSheet ? { par: mapSheet.reduce((sum, h) => sum + h.par, 0), holes: mapSheet.length } : null;
    const found = pickSheetCandidate(row, candidates, mapFacts);
    ask.candidates = candidates.length;
    ask.named = candidates.filter(c => sameFacilityName(row.name, c.name)).length;
    ask.picked = found?.id ?? null;
    if (!found) {
      ask.result = sheetMissReason(row, candidates);
      if (ask.result === 'not_narrowed' && !splitFound) splitFound = clubSectionsFromCandidates(row, candidates);
      console.warn(`[course-catalog] official sheet: no ${provider.source} match for ${row.id} "${row.name}" among ${candidates.length} (${ask.result})`);
      continue;
    }
    // One course listed more than once (foldSheetTwins): each listing is asked
    // for, each budgeted, and the answers must be ONE card. The first with
    // holes is taken; a second with holes that says otherwise means the
    // listings are not one course after all, and nothing is taken.
    let pick = found;
    let detail: Awaited<ReturnType<SheetProvider['detail']>> = null;
    let twinsDisagree = false;
    let outOfBudget = false;
    for (const id of [found.id, ...(found.twins ?? [])]) {
      if (!(await consumeProviderBudget(admin, provider.source))) { outOfBudget = true; break; }
      const answer = await provider.detail(id);
      if (!answer?.row?.hole_data?.length) { detail = detail ?? answer; continue; }
      if (!detail?.row?.hole_data?.length) { detail = answer; pick = { ...found, id }; continue; }
      if (!providersConfirm(detail.row.hole_data, answer.row.hole_data)) twinsDisagree = true;
    }
    if (outOfBudget && !detail?.row?.hole_data?.length) { why = 'budget_refused'; ask.result = 'budget_refused'; continue; }
    if (twinsDisagree) {
      ask.result = 'not_narrowed';
      ask.picked = null;
      console.warn(`[course-catalog] official sheet: ${row.id} "${row.name}": ${provider.source} lists it ${1 + (found.twins?.length ?? 0)} times with different cards`);
      continue;
    }
    ask.picked = pick.id;
    if (!detail) { why = 'provider_error'; ask.result = 'provider_error'; continue; }
    let normalized = detail.row;
    // A nine listed as an eighteen that combines it with another nine: its
    // front nine is this row's card when a SIBLING listing confirms it
    // (nineFromCombination). The siblings are the same search's other listings
    // of this club; each one asked for is budgeted, at most NINE_SIBLINGS_MAX.
    if (row.section_kind === 'nine' && normalized?.hole_data?.length === 18) {
      const club = sectionlessName(row.name);
      const siblingIds = foldSheetTwins(candidates.filter(c => c.id !== pick.id && !(found.twins ?? []).includes(c.id) && sameFacilityName(club, sectionlessName(c.name)))).slice(0, NINE_SIBLINGS_MAX).map(c => c.id);
      const siblingCards: SheetHole[][] = [];
      for (const id of siblingIds) {
        if (!(await consumeProviderBudget(admin, provider.source))) break;
        const other = await provider.detail(id);
        if (other?.row?.hole_data?.length === 18) siblingCards.push(other.row.hole_data);
      }
      const nine = nineFromCombination(normalized.hole_data, siblingCards);
      if (nine) {
        // An eighteen's ratings are not a nine's.
        normalized = { ...normalized, hole_data: nine, holes_count: 9, total_par: nine.reduce((sum, h) => sum + h.par, 0), course_rating: {}, slope_rating: {} };
        ask.fromCombination = true;
      }
    }
    // Holes are what an answer is checked by: one without them adds nothing.
    if (!normalized?.hole_data?.length) { why = 'no_sheet'; ask.result = 'no_holes'; continue; }
    // A nine takes a nine: an eighteen (a combination of two nines) is not this row's card.
    if (row.section_kind === 'nine' && normalized.hole_data.length !== 9) { why = 'no_sheet'; ask.result = 'wrong_holes'; continue; }
    const agreesWithMap = sheetAgreesWithMap(normalized.hole_data, mapSheet);
    // Kept in case another provider says the same against the map (below).
    if (!agreesWithMap) against.push({ source: provider.source, id: pick.id, sheet: normalized });
    const merged = agreesWithMap ? mergeSheets(card, normalized) : null;
    if (!merged || merged.refused) {
      console.warn(`[course-catalog] official sheet: ${row.id} "${row.name}" refused, ${provider.source}:${pick.id} disagrees with the ${merged ? 'card' : 'map'}`);
      why = 'map_disagrees';
      ask.result = merged ? 'card_disagrees' : 'map_disagrees';
      continue;
    }
    ask.result = merged.changed ? 'filled' : 'nothing_new';
    if (merged.changed) {
      if (from.length === 0) sources = await readSheetSources(admin, row.id);
      if (sources !== undefined) {
        const hadPars = !!sources?.pars;
        sources = creditSources(sources, card, merged.sheet, provider.source);
        // The pars came from this answer, and its own tees did not all agree.
        const disputed = (detail?.parsDisputed ?? []).filter(h => h <= (merged.sheet.hole_data?.length ?? 0));
        if (!hadPars && sources.pars === provider.source && disputed.length) {
          sources = { ...sources, parsDisputed: disputed };
          console.warn(`[course-catalog] official sheet: ${row.id} "${row.name}": ${provider.source}:${pick.id}'s tees disagree on the par of hole ${disputed.join(', ')}; the card most tees share was taken`);
        }
      }
      card = merged.sheet;
      from.push(`${provider.source}:${pick.id}`);
    }
  }
  // Two providers against the map (Nov 18 2026, Tom). The map card is
  // protected from ONE wrong same-named course; when two independent
  // providers give the same holes and pars, it is the map that is wrong
  // (measured on production: Lost Marsh Golf Course, refused by both). One
  // provider alone against the map is still refused.
  if (from.length === 0 && against.length >= 2) {
    const [a, b] = against;
    if (a.source !== b.source && providersConfirm(a.sheet.hole_data ?? [], b.sheet.hole_data ?? [])) {
      sources = await readSheetSources(admin, row.id);
      for (const answer of [a, b]) {
        const merged = mergeSheets(card, answer.sheet);
        if (merged.refused || !merged.changed) continue;
        if (sources !== undefined) sources = creditSources(sources, card, merged.sheet, answer.source);
        card = merged.sheet;
        from.push(`${answer.source}:${answer.id}`);
      }
      if (from.length) for (const t of trace) if (t.result === 'map_disagrees') t.result = 'filled';
      if (from.length && sources !== undefined) sources = { ...(sources ?? {}), mapOverruled: true };
      if (from.length) console.warn(`[course-catalog] official sheet: ${row.id} "${row.name}": ${a.source} and ${b.source} agree against the map card; the map is overruled`);
    }
  }
  // ONE provider against the map (Nov 18 2026, Tom, for Club de Golf Gatineau:
  // the provider he pays for held its card and the map's pars refused it).
  // Taken only when it is the single answer with holes, its card is whole and
  // agrees with itself (sheetSelfConsistent) and has the map's hole count. The
  // candidate was already matched on name and place. Tom accepted the cost: a
  // wrong same-named course could replace a correct map card.
  if (from.length === 0 && against.length === 1 && mapSheet && sheetSelfConsistent(against[0].sheet) && against[0].sheet.hole_data?.length === mapSheet.length) {
    const only = against[0];
    const merged = mergeSheets(card, only.sheet);
    if (!merged.refused && merged.changed) {
      sources = await readSheetSources(admin, row.id);
      if (sources !== undefined) sources = { ...creditSources(sources, card, merged.sheet, only.source), mapOverruled: true };
      card = merged.sheet;
      from.push(`${only.source}:${only.id}`);
      for (const t of trace) if (t.source === only.source && t.result === 'map_disagrees') t.result = 'filled';
      console.warn(`[course-catalog] official sheet: ${row.id} "${row.name}": ${only.source} alone against the map card, whole and consistent; the map is overruled`);
    }
  }
  if (from.length === 0) {
    // No card for the club as a whole, and the provider lists its courses:
    // the catalog takes one row per course and the golfer is asked which.
    // (Never a club that is already linked: splitUnlinkedClub.)
    if (splitFound && !hadCard) {
      const split = await splitUnlinkedClub(admin, row, splitFound);
      if (split) return { ...answer('split', split.row, trace), found: false, club: split.club, siblings: split.siblings };
    }
    await releaseSheetAsk(admin, row.id, trace);
    return miss(why, trace);
  }

  // A course made by a club split is 'unspecified' until its card says what it is.
  const learned = row.section_kind === 'unspecified' && row.section_name && (card.hole_data?.length === 18 || card.hole_data?.length === 9) ? { section_kind: card.hole_data.length === 18 ? 'course_18' : 'nine' } : {};
  const sheet = { ...card, ...learned, ...(sources === undefined ? {} : { sheet_sources: sources }), hydrated_at: new Date().toISOString() };
  const { error } = await admin.from('golf_courses').update(sheet).eq('id', row.id);
  if (error) {
    console.error(`[course-catalog] official sheet write failed for ${row.id}:`, error.message);
    return miss('provider_error');
  }
  console.warn(`[course-catalog] official sheet: ${row.external_source}:${row.external_id} "${row.name}" ← ${from.join(' + ')} (${card.hole_data?.length ?? 0} holes, still missing: ${sheetGaps(card).join(', ') || 'nothing'})`);
  return answer('found', { ...row, ...sheet } as CatalogRow, trace);
}

// ── Proximity (GolfCourseAPI v1.3.0, Pro/Enterprise; dormant on Free) ────────

/** ~5 km cells at mid-latitudes: one provider call per cell per day, so a
 *  group tapping "Near me" at the same club spends one request, not one each.
 *  Exported pure for tests. */
export function proximityCellKey(lat: number, lng: number): string {
  const cell = (v: number) => (Math.round(v / 0.05) * 0.05).toFixed(2);
  return `golf-proximity-cell:${cell(lat)},${cell(lng)}`;
}

export type CoordFillDecision = 'fill' | 'keep' | 'disagree';

/** What a provider coordinate does to an EXISTING row: fills a NULL pair;
 *  never overwrites a stored one (it may be a Nominatim-refined pin — provider
 *  coords were 6–22 km off for 3 of 4 probed courses, Aug 2026); a stored pin
 *  more than 1.5 km from the provider's is reported, not moved. */
export function coordFillDecision(
  stored: { lat: number | null; lng: number | null },
  found: { lat: number | null; lng: number | null }
): CoordFillDecision {
  if (found.lat === null || found.lng === null) return 'keep';
  if (stored.lat === null || stored.lng === null) return 'fill';
  return shouldReplaceCoords({ lat: stored.lat, lng: stored.lng }, { lat: found.lat, lng: found.lng }) ? 'disagree' : 'keep';
}

export interface ProximityQuery {
  lat: number;
  lng: number;
  /** Capped at the endpoint's 80 km. */
  radiusKm?: number;
  /** Capped at the endpoint's 25. */
  limit?: number;
}

/**
 * The "near me" provider touchpoint: courses within a radius of a point,
 * upserted as thin rows WITH coordinates (a GCA row with coords now takes the
 * coord branch of the cross-source dedupe); rows the catalog already holds
 * by id gain a coordinate only when they have none (coordFillDecision).
 * Gates, in order, each fail-closed: the plan (never a budget RPC on Free),
 * the per-cell daily memo, the proximity cap, then the shared account cap.
 * Returns whether anything was fetched. The caller re-reads the catalog.
 */
export async function proximitySearch(admin: SupabaseClient, q: ProximityQuery): Promise<boolean> {
  if (!proximityAllowed()) return false;
  if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng)) return false;
  if (!(await hitBudget(admin, proximityCellKey(q.lat, q.lng), 1))) return false;
  if (!(await consumeProviderBudget(admin, 'golfcourseapi-proximity'))) return false;
  if (!(await consumeProviderBudget(admin, 'golfcourseapi'))) return false;

  const radius = Math.min(Math.max(q.radiusKm ?? 50, 1), 80);
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 25);
  const data = (await fetchJson(
    `https://api.golfcourseapi.com/v1/proximity?latitude=${q.lat}&longitude=${q.lng}&radius=${radius}&unit=km&limit=${limit}`,
    gcaHeaders()
  )) as { courses?: GcaProximityCourse[] } | GcaProximityCourse[] | null;
  // The live Pro envelope is unpinned until the plan is on: accept the
  // documented `{courses}` and a bare array.
  const courses = Array.isArray(data) ? data : (data?.courses ?? []);
  const incoming = courses.filter(c => typeof c?.id === 'string' && c.id).map(normalizeGcaProximity);
  if (!incoming.length) return false;

  // Rows the catalog already holds by id: a coordinate fill at most, and
  // NEVER back through upsertThinRows (a coord row there would match ITSELF
  // in the 2 km box and log a false dedupe skip).
  const { data: existingRows } = await admin
    .from('golf_courses')
    .select('id, external_id, lat, lng')
    .eq('external_source', 'golfcourseapi')
    .in('external_id', incoming.map(r => r.external_id));
  const existing = new Map(
    ((existingRows as { id: string; external_id: string; lat: number | null; lng: number | null }[] | null) ?? []).map(r => [r.external_id, r])
  );
  const fresh: NewRow[] = [];
  for (const row of incoming) {
    const { distanceKm: _distanceKm, ...thin } = row;
    void _distanceKm;
    const stored = existing.get(row.external_id);
    if (!stored) {
      fresh.push(thin);
      continue;
    }
    const decision = coordFillDecision(stored, row);
    if (decision === 'fill') {
      const { error } = await admin.from('golf_courses').update({ lat: row.lat, lng: row.lng }).eq('id', stored.id);
      if (error) console.error(`[course-catalog] proximity coord fill failed for ${stored.id}:`, error.message);
    } else if (decision === 'disagree') {
      console.warn(
        `[course-catalog] proximity coords disagree with the stored pin for golfcourseapi:${row.external_id} "${row.name}" (kept stored)`
      );
    }
  }
  if (fresh.length) await upsertThinRows(admin, fresh);
  return true;
}

/** The catalog row's tee sheet — par, stroke index and every tee's yardage
 *  per hole plus the ratings — read from the ROW with NO hydration (no
 *  provider budget): what the live scorer's hole header shows beside the
 *  round's own hole_data. Null when the course has no hole data at all. */
export interface CourseSheet {
  holes: CourseHole[];
  courseRating: Record<string, number>;
  slopeRating: Record<string, number>;
  /** The row's provenance ('seed' | 'opengolfapi' | 'golfcourseapi' | 'osm' …). */
  source: string;
  /** What is missing (H1): no hole-by-hole data at all, or holes with no
   *  yardage on any tee. Null when the sheet is complete. */
  partial: 'no_holes' | 'no_yardage' | null;
}

/** The sheet as a pure projection of a row — null only for a missing row;
 *  an empty `hole_data` is `partial: 'no_holes'` with `holes: []`. */
export function sheetFromRow(row: Pick<CatalogRow, 'hole_data' | 'course_rating' | 'slope_rating' | 'external_source'>): CourseSheet {
  const holes = row.hole_data ?? [];
  const anyYardage = holes.some(h => Object.values(h.yardage ?? {}).some(y => typeof y === 'number' && y > 0));
  return {
    holes,
    courseRating: row.course_rating ?? {},
    slopeRating: row.slope_rating ?? {},
    source: row.external_source,
    partial: holes.length === 0 ? 'no_holes' : anyYardage ? null : 'no_yardage',
  };
}

export async function getCourseSheet(admin: SupabaseClient, courseId: string): Promise<CourseSheet | null> {
  const row = await getCatalogRow(admin, courseId);
  return row ? sheetFromRow(row) : null;
}

/** Nominatim reverse result → the location columns a row is still missing. */
function reverseFill(
  row: CatalogRow,
  fill: { city: string | null; region: string | null; country: string | null }
): Pick<CatalogRow, 'city' | 'region' | 'region_code' | 'country' | 'country_code' | 'location_source'> {
  const country = normalizeCountry(fill.country);
  const region = normalizeRegion(fill.region, country?.code ?? row.country_code);
  return {
    city: row.city ?? fill.city,
    region: row.region ?? region?.name ?? null,
    region_code: row.region_code ?? region?.code ?? null,
    country: row.country ?? country?.name ?? null,
    country_code: row.country_code ?? country?.code ?? null,
    location_source: row.location_source ?? 'nominatim',
  };
}

/** Why a hydration ended the way it did (H1, Oct 2026). `ok` and `fresh`
 *  are the quiet outcomes; `not_applicable` is a seed / OSM row (nothing to
 *  ask a provider for); the OPERATIONAL outcomes (`http_5xx`, `timeout`,
 *  `network`, `budget_refused`) reach Sentry as warnings; the DATA GAPS
 *  (`no_tees`, `no_yardage_for_tee`, `provider_null`, `http_404`,
 *  `not_configured`) are catalog facts and stay on the console. */
export interface HydrationOutcome {
  source: CatalogRow['external_source'];
  external_id: string;
  outcome:
    | 'ok'
    | 'fresh'
    | 'not_applicable'
    | 'not_configured'
    | 'budget_refused'
    | 'provider_null'
    /** The provider's host just failed and is being skipped (provider-breaker.ts). */
    | 'provider_down'
    | 'no_tees'
    | 'no_yardage_for_tee'
    | `http_${number}`
    | 'timeout'
    | 'network';
  holes: number;
  tees: number;
}

export const HYDRATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Is this row due a provider attempt: a provider source, thin, and not
 *  attempted within the TTL. The `?holes=1` door asks this before building
 *  a sheet so the live page and the preview card get the tee sheet without
 *  a composer selection first (H1). Pure. */
export function hydrationDue(
  row: Pick<CatalogRow, 'external_source' | 'hole_data' | 'course_rating' | 'slope_rating' | 'hydrated_at'>,
  now: number = Date.now()
): boolean {
  if (row.external_source !== 'opengolfapi' && row.external_source !== 'golfcourseapi') return false;
  if (!isThinRow(row)) return false;
  return !(row.hydrated_at && now - new Date(row.hydrated_at).getTime() < HYDRATE_TTL_MS);
}

const OPERATIONAL_OUTCOMES = new Set(['budget_refused', 'timeout', 'network']);

function reportHydration(outcome: HydrationOutcome): void {
  // `provider_down` is quiet: the call that found the host down already reported it.
  if (outcome.outcome === 'ok' || outcome.outcome === 'fresh' || outcome.outcome === 'not_applicable' || outcome.outcome === 'provider_down') return;
  const operational = OPERATIONAL_OUTCOMES.has(outcome.outcome) || /^http_5\d\d$/.test(outcome.outcome);
  if (operational) reportRouteWarning('[hydrate] provider trouble', { ...outcome });
  else console.warn('[hydrate] partial course data', outcome);
}

/**
 * Hydration on selection: a thin provider row gets one detail call and an
 * in-place UPDATE. Any failure (budget, timeout, bad shape) returns the thin
 * course unchanged — selection must never error on provider weather.
 */
export async function hydrateCourse(admin: SupabaseClient, row: CatalogRow): Promise<GolfCourse> {
  return (await hydrateCourseDetailed(admin, row)).course;
}

/** `hydrateCourse` with its OUTCOME beside the course (H1) — every outcome
 *  that is not quiet is logged once here, so no caller has to. */
export async function hydrateCourseDetailed(
  admin: SupabaseClient,
  row: CatalogRow
): Promise<{ course: GolfCourse; outcome: HydrationOutcome }> {
  const base = { source: row.external_source, external_id: row.external_id };
  const counts = (r: Pick<CatalogRow, 'hole_data' | 'course_rating'>) => ({
    holes: r.hole_data?.length ?? 0,
    tees: new Set([...Object.keys(r.course_rating ?? {}), ...(r.hole_data ?? []).flatMap(h => Object.keys(h.yardage ?? {}))]).size,
  });
  const done = (course: GolfCourse, outcome: HydrationOutcome['outcome'], r: Pick<CatalogRow, 'hole_data' | 'course_rating'> = row) => {
    const full: HydrationOutcome = { ...base, outcome, ...counts(r) };
    reportHydration(full);
    return { course, outcome: full };
  };
  if (row.external_source === 'seed') return done(rowToCourse(row), 'not_applicable');
  // hydrated_at gates on ATTEMPTED, not on how much data came back: a course
  // whose provider detail is genuinely empty used to look thin forever and
  // re-fetched on every selection. One attempt per 7 days. (Also lets rows
  // hydrated before the details columns existed pick them up once.)
  if (row.hydrated_at && Date.now() - new Date(row.hydrated_at).getTime() < HYDRATE_TTL_MS) {
    return done(rowToCourse(row), 'fresh');
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
    // Fill only what's missing (a gazetteer/OSM value already there is at
    // least as good), and carry the ISO codes alongside the names.
    const filled = fill ? reverseFill(row, fill) : null;
    await admin
      .from('golf_courses')
      .update({ hydrated_at: new Date().toISOString(), ...(filled ?? {}) })
      .eq('id', row.id);
    return done(rowToCourse(filled ? { ...row, ...filled } : row), 'not_applicable');
  }

  let normalized: NewRow | null = null;
  // Why the provider branch produced nothing — reported once at the end.
  let miss: HydrationOutcome['outcome'] = 'not_configured';
  const readProvider = async (url: string, headers?: Record<string, string>): Promise<unknown | null> => {
    const r = await fetchJsonResult(url, headers);
    if (r.ok) {
      miss = 'provider_null';
      return r.body;
    }
    miss = typeof r.status === 'number' ? (`http_${r.status}` as const) : r.status === 'down' ? 'provider_down' : r.status;
    return null;
  };
  // A provider whose host just failed (provider-breaker.ts) is not asked, not
  // charged for, and the row is NOT stamped: nothing was attempted, so the
  // next selection after the host recovers still gets its one attempt.
  const ownHost = row.external_source === 'opengolfapi' ? 'https://api.opengolfapi.org/' : row.external_source === 'golfcourseapi' ? 'https://api.golfcourseapi.com/' : null;
  if (ownHost && providerHostDown(ownHost)) return done(rowToCourse(row), 'provider_down');
  if (row.external_source === 'opengolfapi' && openGolfConfigured()) {
    if (await consumeProviderBudget(admin, 'opengolfapi')) {
      const data = (await readProvider(
        `https://api.opengolfapi.org/api/v1/courses/${encodeURIComponent(row.external_id)}`
      )) as OpenGolfDetail | null;
      if (data?.id) normalized = normalizeOpenGolfDetail(data);
    } else miss = 'budget_refused';
  } else if (row.external_source === 'golfcourseapi' && gcaConfigured()) {
    if (await consumeProviderBudget(admin, 'golfcourseapi')) {
      // LIVE shape: detail nests under `course` (the published spec says bare).
      const data = (await readProvider(
        `https://api.golfcourseapi.com/v1/courses/${encodeURIComponent(row.external_id)}`,
        gcaHeaders()
      )) as { course?: GcaDetail } | null;
      if (data?.course?.id) normalized = normalizeGcaDetail(data.course);
    } else miss = 'budget_refused';
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
    return done(rowToCourse(refined ? { ...row, lat: refined.lat, lng: refined.lng } : row), miss);
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

  // Nov 16 2026: the answer FILLS the stored card and never replaces it. A
  // card found by name on the other provider used to be overwritten here by
  // this provider's thinner answer; an answer that looks like a different
  // course is refused whole.
  const merged = mergeSheets(row, normalized);
  const credits = merged.changed ? await readSheetSources(admin, row.id) : undefined;
  if (merged.refused) {
    console.warn(`[course-catalog] hydrate: ${row.id} "${row.name}" kept its card, ${row.external_source}:${row.external_id} disagrees with it`);
  }

  const { data: updated } = await admin
    .from('golf_courses')
    .update({
      name: normalized.name,
      club_name: normalized.club_name,
      // Provider location overwrites everything except an OSM addr:* value
      // (a mapper's tag beats a provider's summary), and only when the
      // provider actually knows it.
      ...(row.location_source === 'osm'
        ? {}
        : {
            city: normalized.city ?? row.city,
            region: normalized.region ?? row.region,
            region_code: normalized.region_code ?? row.region_code,
            country: normalized.country ?? row.country,
            country_code: normalized.country_code ?? row.country_code,
            location_source: normalized.country_code || normalized.region ? 'provider' : row.location_source,
          }),
      // Oct 31 2026: an empty provider answer never erases a sheet the row
      // already holds (the refresh runs again every 7 days). Nov 16: nor does
      // a thinner one — see mergeSheets.
      total_par: merged.sheet.total_par,
      holes_count: merged.sheet.holes_count,
      hole_data: merged.sheet.hole_data,
      course_rating: merged.sheet.course_rating,
      slope_rating: merged.sheet.slope_rating,
      ...(credits === undefined ? {} : { sheet_sources: creditSources(credits, row, merged.sheet, row.external_source) }),
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

  // The provider answered — but with what? No tees at all, or holes whose
  // tee boxes disagreed in count (GolfCourseAPI only fills matching boxes)
  // so no hole carries a yardage: both are real, recorded shapes.
  const written = (updated as unknown as CatalogRow) ?? { ...row, ...normalized };
  const anyYardage = (normalized.hole_data ?? []).some(h => Object.values(h.yardage ?? {}).some(y => typeof y === 'number' && y > 0));
  const outcome: HydrationOutcome['outcome'] = !normalized.hole_data ? 'no_tees' : anyYardage ? 'ok' : 'no_yardage_for_tee';
  return done(rowToCourse(written), outcome, normalized);
}
