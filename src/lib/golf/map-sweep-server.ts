// ── The proactive course-map sweep — the I/O half (map sweep PR 6, Oct 2026)
// Everything that touches the database, Overpass or the terrain tiles lives
// here; every rule is in map-sweep.ts (pure) and hole-geometry.ts (the ONE
// pipeline, resolveCourseTiers). The admin route and the cron tick call the
// four phases below with a time budget; nothing here throws past a phase —
// a failure parks the cell with a backoff, and a dry run touches nothing.

import type { SupabaseClient } from '@supabase/supabase-js';
import { consumeProviderBudget, hydrateCourseDetailed, hydrationDue, type CatalogRow } from '@/lib/golf/course-catalog';
import { getCourseHoleElevation } from '@/lib/golf/elevation-server';
import {
  MIRRORS,
  OVERPASS_UA,
  isOverpassAnswer,
  isOverpassPartial,
  resolveCourseTiers,
  type HoleGeometry,
  type OverpassElement,
  type SectionRowLite,
} from '@/lib/golf/hole-geometry';
import {
  CELL_GAP_MS,
  CELL_START_RESERVE_MS,
  CELL_TTL_MS,
  COURSE_GAP_MS,
  CELL_ELEMENTS_WARN,
  LEASE_SECONDS,
  MIRROR_COOLDOWN_MS,
  REQUEST_TIMEOUT_MS,
  WORK_BUDGET_MS,
  cellBounds,
  cellQueryBbox,
  elementsNear,
  emptyMetrics,
  hasHoleWays,
  holesUnchanged,
  overpassCellQuery,
  pickMirror,
  planCells,
  retryDelayMs,
  type CellMetrics,
  type PlanCourse,
  type PlannedCell,
  type SweepBatchSummary,
} from '@/lib/golf/map-sweep';
import { reportRouteWarning } from '@/lib/observability/report';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowIso = (t = Date.now()) => new Date(t).toISOString();

/** The mirror ladder: the env's list, else the lazy path's. */
export function sweepMirrors(): string[] {
  const env = (process.env.GOLF_SWEEP_OVERPASS_MIRRORS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return env.length ? env : MIRRORS;
}

// ── Meta ──────────────────────────────────────────────────────────────────────

async function readMeta<T>(admin: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await admin.from('golf_map_sweep_meta').select('value').eq('key', key).maybeSingle();
  return ((data as { value?: T } | null)?.value ?? null) as T | null;
}

async function writeMeta(admin: SupabaseClient, key: string, value: unknown): Promise<void> {
  await admin.from('golf_map_sweep_meta').upsert({ key, value, updated_at: nowIso() }, { onConflict: 'key' });
}

// ── Phase: plan ───────────────────────────────────────────────────────────────

export interface PlanResult {
  ok: true;
  dryRun: boolean;
  cells: number;
  courses: number;
  tiers: Record<string, number>;
  first: PlannedCell[];
}

/** The world's cells from the catalog (keyset-paged by id), with the rounds
 *  recorded on each course as activity. The upsert writes ONLY the planner's
 *  columns, so a cell's state survives a re-plan; a new cell is born
 *  pending and due. */
export async function planSweepCells(admin: SupabaseClient, opts: { dryRun: boolean }): Promise<PlanResult | { ok: false; error: string }> {
  const courses: PlanCourse[] = [];
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    let q = admin
      .from('golf_courses')
      .select('id, lat, lng, country_code, external_source')
      .not('lat', 'is', null)
      .neq('external_source', 'qa-e2e')
      .order('id')
      .limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as PlanCourse[];
    courses.push(...rows);
    if (rows.length < 1000) break;
    after = rows[rows.length - 1].id;
  }
  const rounds = new Map<string, number>();
  let afterRound: string | null = null;
  for (let page = 0; page < 100; page++) {
    let q = admin.from('golf_rounds').select('id, course_id').not('course_id', 'is', null).order('id').limit(1000);
    if (afterRound) q = q.gt('id', afterRound);
    const { data, error } = await q;
    if (error) break; // activity is a priority hint, never a blocker
    const rows = (data ?? []) as Array<{ id: string; course_id: string }>;
    for (const r of rows) rounds.set(r.course_id, (rounds.get(r.course_id) ?? 0) + 1);
    if (rows.length < 1000) break;
    afterRound = rows[rows.length - 1].id;
  }
  const cells = planCells(courses, rounds);
  const tiers: Record<string, number> = {};
  for (const c of cells) tiers[String(c.tier)] = (tiers[String(c.tier)] ?? 0) + 1;
  if (!opts.dryRun) {
    for (let i = 0; i < cells.length; i += 500) {
      const chunk = cells.slice(i, i + 500).map(c => ({ ...c, planned_at: nowIso() }));
      const { error } = await admin.from('golf_map_sweep_cells').upsert(chunk, { onConflict: 'cell_key' });
      if (error) return { ok: false, error: error.message };
    }
    await writeMeta(admin, 'plan', { at: nowIso(), cells: cells.length, courses: courses.length });
  }
  return { ok: true, dryRun: opts.dryRun, cells: cells.length, courses: courses.length, tiers, first: cells.slice(0, 20) };
}

// ── The fetch ─────────────────────────────────────────────────────────────────

export interface CellFetch {
  reached: boolean;
  payload?: { elements: OverpassElement[] };
  mirror?: string;
  error?: string;
  ms: number;
}

/** One regional query through the mirror ladder, cooling a mirror that
 *  answers badly. A 200 without the envelope or with a partial remark is a
 *  failure, never an answer. */
export async function fetchCellPayload(
  cellKey: string,
  mirrors: string[],
  cooldowns: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now()
): Promise<CellFetch> {
  const bbox = cellQueryBbox(cellKey);
  if (!bbox) return { reached: false, error: 'bad cell key', ms: 0 };
  const query = overpassCellQuery(bbox);
  const t0 = Date.now();
  let lastError = 'no mirror answered';
  for (const mirror of pickMirror(mirrors, cooldowns, now)) {
    try {
      const res = await fetchImpl(mirror, {
        method: 'POST',
        headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        cooldowns[mirror] = nowIso(now + (res.status === 429 ? MIRROR_COOLDOWN_MS[429] : MIRROR_COOLDOWN_MS.other));
        lastError = `${mirror.split('/')[2]} ${res.status}`;
        continue;
      }
      const payload = (await res.json()) as unknown;
      if (!isOverpassAnswer(payload)) { lastError = `${mirror.split('/')[2]} stub`; continue; }
      if (isOverpassPartial(payload)) { lastError = `${mirror.split('/')[2]} partial`; continue; }
      return { reached: true, payload: payload as { elements: OverpassElement[] }, mirror, ms: Date.now() - t0 };
    } catch (e) {
      lastError = `${mirror.split('/')[2]} ${(e as Error)?.name ?? 'error'}`;
    }
  }
  return { reached: false, error: lastError, ms: Date.now() - t0 };
}

// ── Phase: geometry ───────────────────────────────────────────────────────────

interface CellRow {
  cell_key: string;
  attempts: number;
  mapped: number;
  status: string;
}

interface CourseRow {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  club_id: string | null;
  holes_count: number | null;
  hole_geometry: HoleGeometry | null;
  hole_elevation_at: string | null;
}

async function release(admin: SupabaseClient, key: string): Promise<void> {
  await admin.from('golf_map_sweep_cells').update({ status: 'pending', leased_until: null }).eq('cell_key', key);
}

async function park(admin: SupabaseClient, cell: CellRow, error: string, now: number): Promise<void> {
  const attempts = (cell.attempts ?? 0) + 1;
  await admin
    .from('golf_map_sweep_cells')
    .update({ status: 'pending', leased_until: null, attempts, error, next_due_at: nowIso(now + retryDelayMs(attempts)) })
    .eq('cell_key', cell.cell_key);
  if (attempts >= 3) reportRouteWarning('[map-sweep] cell unreachable', { cell_key: cell.cell_key, error, attempts });
}

/** The courses of one cell (the box, never a QA fixture). */
async function cellCourses(admin: SupabaseClient, key: string): Promise<CourseRow[] | null> {
  const b = cellBounds(key);
  if (!b) return null;
  const { data, error } = await admin
    .from('golf_courses')
    .select('id, name, lat, lng, club_id, holes_count, hole_geometry, hole_elevation_at')
    .gte('lat', b.lat0).lt('lat', b.lat1).gte('lng', b.lng0).lt('lng', b.lng1)
    .neq('external_source', 'qa-e2e')
    .limit(2000);
  if (error) return null;
  return (data ?? []) as CourseRow[];
}

export interface GeometryBatchOptions {
  cells: number;
  dryRun: boolean;
  /** Run ONE named cell, claimed whatever its due date (the rollout's door). */
  cellKey?: string | null;
  now?: number;
  fetchImpl?: typeof fetch;
  budget?: () => Promise<boolean>;
}

/** The invocation loop: claim → (per cell) time guard → budget → fetch →
 *  the pipeline per course → stamp → done, or park. */
export async function runGeometryBatch(admin: SupabaseClient, opts: GeometryBatchOptions): Promise<SweepBatchSummary | { ok: false; error: string }> {
  const t0 = opts.now ?? Date.now();
  const summary: SweepBatchSummary = { phase: 'geometry', dryRun: opts.dryRun, cells: [], remaining: 0, budgetExhausted: false, elapsedMs: 0 };
  const budget = opts.budget ?? (() => consumeProviderBudget(admin, 'sweep-overpass'));
  const mirrors = sweepMirrors();
  const cooldowns = (await readMeta<Record<string, string>>(admin, 'mirrors')) ?? {};

  let claimed: CellRow[] = [];
  if (opts.cellKey) {
    if (!cellBounds(opts.cellKey)) return { ok: false, error: 'bad cell key' };
    const { data, error } = await admin
      .from('golf_map_sweep_cells')
      .update({ status: 'running', leased_until: nowIso(t0 + LEASE_SECONDS * 1000) })
      .eq('cell_key', opts.cellKey)
      .select('cell_key, attempts, mapped, status');
    if (error) return { ok: false, error: error.message };
    claimed = (data ?? []) as CellRow[];
    if (!claimed.length) return { ok: false, error: 'no such cell — plan first' };
  } else {
    const { data, error } = await admin.rpc('golf_map_sweep_claim', { p_n: Math.max(1, Math.min(opts.cells, 6)), p_lease_seconds: LEASE_SECONDS });
    if (error) return { ok: false, error: error.code === '42883' || error.code === '42P01' ? 'migration 255 has not run' : error.message };
    claimed = (data ?? []) as CellRow[];
  }

  for (let i = 0; i < claimed.length; i++) {
    const cell = claimed[i];
    const elapsed = Date.now() - t0;
    if (elapsed > WORK_BUDGET_MS - CELL_START_RESERVE_MS) {
      await release(admin, cell.cell_key);
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'released' });
      continue;
    }
    if (opts.dryRun) {
      const courses = (await cellCourses(admin, cell.cell_key)) ?? [];
      const m = emptyMetrics(courses.length, 0);
      m.mapped = courses.filter(c => c.hole_geometry && c.hole_geometry.holes.length > 0).length;
      await release(admin, cell.cell_key);
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'dry_run', metrics: m });
      continue;
    }
    if (!(await budget())) {
      await release(admin, cell.cell_key);
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'skipped_budget' });
      summary.budgetExhausted = true;
      break;
    }
    const fetched = await fetchCellPayload(cell.cell_key, mirrors, cooldowns, opts.fetchImpl ?? fetch, Date.now());
    await writeMeta(admin, 'mirrors', cooldowns);
    if (!fetched.reached || !fetched.payload) {
      await park(admin, cell, fetched.error ?? 'transport', Date.now());
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'transport', error: fetched.error, ms: fetched.ms });
      continue;
    }
    const elements = fetched.payload.elements;
    // The empty-answer regression guard: a cell that HAD mapped courses and
    // now answers nothing at all is a bad mirror day, not a vanished course.
    if (elements.length === 0 && (cell.mapped ?? 0) > 0) {
      await park(admin, cell, 'empty_answer_regression', Date.now());
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'transport', error: 'empty_answer_regression', ms: fetched.ms });
      continue;
    }
    if (elements.length > CELL_ELEMENTS_WARN) console.warn(`[map-sweep] ${cell.cell_key}: ${elements.length} elements — consider splitting`);
    const courses = await cellCourses(admin, cell.cell_key);
    if (!courses) {
      await release(admin, cell.cell_key);
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'released', error: 'course read failed' });
      continue;
    }
    const result = await sweepCellCourses(admin, courses, elements, Date.now());
    if (!result.ok) {
      await release(admin, cell.cell_key);
      summary.cells.push({ cell_key: cell.cell_key, outcome: 'released', error: result.error });
      continue;
    }
    const m = result.metrics;
    m.elements = elements.length;
    const stamp = Date.now();
    await admin
      .from('golf_map_sweep_cells')
      .update({
        status: 'done', leased_until: null, attempts: 0, error: null, attempted_at: nowIso(stamp), next_due_at: nowIso(stamp + CELL_TTL_MS),
        courses: m.courses, attempted: m.attempted, mapped: m.mapped, with_greens: m.with_greens, sections: m.sections, derived: m.derived,
        greens_only: m.greens_only, null_no_coverage: m.null_no_coverage, refused: m.refused, elements: m.elements,
        duration_ms: Date.now() - (stamp - fetched.ms), mirror: fetched.mirror ?? null,
      })
      .eq('cell_key', cell.cell_key);
    summary.cells.push({ cell_key: cell.cell_key, outcome: 'done', metrics: m, mirror: fetched.mirror, ms: fetched.ms });
    if (i < claimed.length - 1) await sleep(CELL_GAP_MS);
  }

  const { count } = await admin
    .from('golf_map_sweep_cells')
    .select('cell_key', { count: 'exact', head: true })
    .lte('next_due_at', nowIso())
    .neq('status', 'running');
  summary.remaining = count ?? 0;
  summary.elapsedMs = Date.now() - t0;
  await writeMeta(admin, 'last_run', { at: nowIso(), phase: 'geometry', cells: summary.cells.length, elapsedMs: summary.elapsedMs, budgetExhausted: summary.budgetExhausted });
  return summary;
}

/** Every course of a cell through THE pipeline, then the stamps in parallel
 *  chunks of eight. A club's section rows are read once per club. The
 *  elevation re-attest: unchanged lines + a prior profile → the profile's
 *  stamp moves with the geometry's, so a re-sweep never invalidates it. */
export async function sweepCellCourses(
  admin: SupabaseClient,
  courses: CourseRow[],
  elements: OverpassElement[],
  now: number
): Promise<{ ok: true; metrics: CellMetrics } | { ok: false; error: string }> {
  const metrics = emptyMetrics(courses.length, elements.length);
  const sectionsByClub = new Map<string, SectionRowLite[]>();
  const writes = new Map<string, { hole_geometry: HoleGeometry | null; reattest: boolean }>();
  const stamp = nowIso(now);
  for (const course of courses) {
    if (writes.has(course.id)) continue; // a sibling the split already labelled
    let sections: SectionRowLite[] = [];
    if (course.club_id) {
      if (!sectionsByClub.has(course.club_id)) {
        const { data } = await admin.from('golf_courses').select('id, name, section_name').eq('club_id', course.club_id).not('section_name', 'is', null);
        sectionsByClub.set(course.club_id, (data ?? []) as SectionRowLite[]);
      }
      sections = sectionsByClub.get(course.club_id) ?? [];
    }
    const near = elementsNear(elements, [course.lat, course.lng]);
    const tiers = resolveCourseTiers({ version: 0.6, elements: near }, { name: course.name, lat: course.lat, lng: course.lng, holesCount: course.holes_count }, sections);
    metrics.attempted += 1;
    let geometry = tiers.geometry;
    if (tiers.siblings.size) {
      for (const [id, g] of tiers.siblings) {
        if (id === course.id) { geometry = g; continue; }
        const sibling = courses.find(c => c.id === id);
        writes.set(id, { hole_geometry: g, reattest: !!sibling && holesUnchanged(sibling.hole_geometry, g) && !!sibling.hole_elevation_at });
        metrics.sections += 1;
      }
    }
    if (geometry) {
      if (geometry.holes.length) metrics.mapped += 1;
      if (geometry.greens?.some(g => g.hole != null)) metrics.with_greens += 1;
      if (geometry.sections) metrics.sections += 1;
      if (geometry.derived) metrics.derived += 1;
      if (!geometry.holes.length && !geometry.sections && geometry.greens?.length) metrics.greens_only += 1;
    } else if (tiers.reason === 'no_coverage' || tiers.reason === 'greens_only') {
      metrics.null_no_coverage += 1;
    } else if (tiers.reason) {
      metrics.refused[tiers.reason] = (metrics.refused[tiers.reason] ?? 0) + 1;
    }
    writes.set(course.id, { hole_geometry: geometry, reattest: holesUnchanged(course.hole_geometry, geometry) && !!course.hole_elevation_at && !!geometry });
    if (courses.length > 40) await sleep(0); // yield on a dense cell
  }
  // Nothing of the above touched the database for a course; the stamps do,
  // and a cell is done only when every one of them succeeded.
  const entries = [...writes.entries()];
  for (let i = 0; i < entries.length; i += 8) {
    const chunk = entries.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map(([id, w]) =>
        admin
          .from('golf_courses')
          .update({ hole_geometry: w.hole_geometry, hole_geometry_at: stamp, ...(w.reattest ? { hole_elevation_at: stamp } : {}) })
          .eq('id', id)
      )
    );
    const failed = results.find(r => r.error);
    if (failed?.error) return { ok: false, error: failed.error.message };
  }
  if (hasHoleWays(elements) === false && courses.length && metrics.null_no_coverage === courses.length) {
    // Every course in a cell with no hole way: honest, but worth one line.
    console.log(`[map-sweep] cell has no golf=hole way at all: ${courses.length} courses stamped no-coverage`);
  }
  return { ok: true, metrics };
}

// ── Phase: elevation ──────────────────────────────────────────────────────────

export interface ElevationBatchSummary {
  phase: 'elevation';
  dryRun: boolean;
  due: string[];
  done: number;
  budgetExhausted: boolean;
  elapsedMs: number;
}

/** Courses whose profile is missing, stale or older than their geometry,
 *  through the lazy path's own `getCourseHoleElevation` with the sweep's
 *  budget, politely spaced. */
export async function runElevationBatch(
  admin: SupabaseClient,
  opts: { courses: number; dryRun: boolean; now?: number; deadlineMs?: number; budget?: () => Promise<boolean> }
): Promise<ElevationBatchSummary | { ok: false; error: string }> {
  const t0 = opts.now ?? Date.now();
  const deadline = t0 + (opts.deadlineMs ?? WORK_BUDGET_MS);
  const { data, error } = await admin.rpc('golf_map_sweep_elevation_due', { p_limit: Math.max(1, Math.min(opts.courses, 50)) });
  if (error) return { ok: false, error: error.code === '42883' ? 'migration 255 has not run' : error.message };
  const due = ((data ?? []) as Array<{ id: string }>).map(r => r.id);
  const summary: ElevationBatchSummary = { phase: 'elevation', dryRun: opts.dryRun, due, done: 0, budgetExhausted: false, elapsedMs: 0 };
  if (opts.dryRun) { summary.elapsedMs = Date.now() - t0; return summary; }
  const budget = opts.budget ?? (() => consumeProviderBudget(admin, 'sweep-terrain'));
  for (const id of due) {
    if (Date.now() > deadline - 6000) break;
    let allowed = true;
    const result = await getCourseHoleElevation(admin, id, async () => { allowed = await budget(); return allowed; });
    if (!allowed) { summary.budgetExhausted = true; break; }
    if (result) summary.done += 1;
    await sleep(COURSE_GAP_MS);
  }
  summary.elapsedMs = Date.now() - t0;
  return summary;
}

// ── Phase: hydration ──────────────────────────────────────────────────────────

export interface HydrationBatchSummary {
  phase: 'hydration';
  dryRun: boolean;
  due: number;
  outcomes: Record<string, number>;
  elapsedMs: number;
}

/** The provider rows never (or not lately) asked for their tee sheet. */
export async function runHydrationBatch(admin: SupabaseClient, opts: { rows: number; dryRun: boolean; now?: number }): Promise<HydrationBatchSummary | { ok: false; error: string }> {
  const t0 = opts.now ?? Date.now();
  const since = nowIso(t0 - 7 * 24 * 60 * 60 * 1000);
  const { data, error } = await admin
    .from('golf_courses')
    .select('*')
    .in('external_source', ['opengolfapi', 'golfcourseapi'])
    .or(`hydrated_at.is.null,hydrated_at.lt.${since}`) // hardening-ok: a server-built timestamp, no user input
    .order('hydrated_at', { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(opts.rows, 20)));
  if (error) return { ok: false, error: error.message };
  const rows = ((data ?? []) as CatalogRow[]).filter(r => hydrationDue(r, t0));
  const summary: HydrationBatchSummary = { phase: 'hydration', dryRun: opts.dryRun, due: rows.length, outcomes: {}, elapsedMs: 0 };
  if (!opts.dryRun) {
    for (const row of rows) {
      const { outcome } = await hydrateCourseDetailed(admin, row);
      summary.outcomes[outcome.outcome] = (summary.outcomes[outcome.outcome] ?? 0) + 1;
      await sleep(COURSE_GAP_MS);
    }
  }
  summary.elapsedMs = Date.now() - t0;
  return summary;
}

// ── Progress ──────────────────────────────────────────────────────────────────

export interface SweepProgress {
  ok: true;
  cells: { total: number; done: number; pending: number; running: number; stale: number };
  courses: { attempted: number; mapped: number; with_greens: number; sections: number; derived: number; greens_only: number; null_no_coverage: number; refused: Record<string, number> };
  elevation: { done: number; due: number; dueCapped: boolean };
  hydrationDue: number;
  budgets: Record<string, { count: number; window_start: string } | null>;
  next: Array<{ cell_key: string; tier: number; courses: number; rounds: number; status: string; next_due_at: string }>;
  lastRun: unknown;
  plan: unknown;
}

/** PostgREST answers at most this many rows per request (the project's
 *  max-rows); the cell table is read in pages of it. */
const PAGE = 1000;

export async function readSweepProgress(admin: SupabaseClient): Promise<SweepProgress | { ok: false; error: string }> {
  // Every cell, in pages — the first production plan wrote 6,325 cells and a
  // single `.limit(10000)` came back capped at 1,000 (the panel read "1,000
  // cells" for the world). Keyset on (priority, cell_key) through ranges.
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await admin
      .from('golf_map_sweep_cells')
      .select('cell_key, tier, status, priority, courses, rounds, attempted, mapped, with_greens, sections, derived, greens_only, null_no_coverage, refused, next_due_at')
      .order('priority')
      .order('cell_key')
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.code === '42P01' ? 'migration 255 has not run' : error.message };
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const now = Date.now();
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const cells = { total: rows.length, done: 0, pending: 0, running: 0, stale: 0 };
  const courses = { attempted: 0, mapped: 0, with_greens: 0, sections: 0, derived: 0, greens_only: 0, null_no_coverage: 0, refused: {} as Record<string, number> };
  for (const r of rows) {
    const status = String(r.status);
    if (status === 'done') cells.done += 1; else if (status === 'running') cells.running += 1; else cells.pending += 1;
    if (status === 'done' && Date.parse(String(r.next_due_at)) <= now) cells.stale += 1;
    for (const k of ['attempted', 'mapped', 'with_greens', 'sections', 'derived', 'greens_only', 'null_no_coverage'] as const) courses[k] += num(r[k]);
    for (const [k, v] of Object.entries((r.refused as Record<string, number>) ?? {})) courses.refused[k] = (courses.refused[k] ?? 0) + num(v);
  }
  const next = rows
    .filter(r => r.status !== 'done' || Date.parse(String(r.next_due_at)) <= now)
    .slice(0, 10)
    .map(r => ({ cell_key: String(r.cell_key), tier: num(r.tier), courses: num(r.courses), rounds: num(r.rounds), status: String(r.status), next_due_at: String(r.next_due_at) }));
  const [elevDone, elevDue, hydr, budgetRows, lastRun, plan] = await Promise.all([
    admin.from('golf_courses').select('id', { count: 'exact', head: true }).not('hole_elevation', 'is', null),
    // The RPC's rows are capped by max-rows too: ask for the cap and report
    // "1,000+" through `dueCapped` rather than a number that is quietly wrong.
    admin.rpc('golf_map_sweep_elevation_due', { p_limit: PAGE }),
    admin.from('golf_courses').select('id', { count: 'exact', head: true }).in('external_source', ['opengolfapi', 'golfcourseapi']).is('hole_data', null),
    admin.from('rate_limits').select('key, count, window_start').in('key', ['golf-provider:sweep-overpass', 'golf-provider:sweep-terrain']),
    readMeta(admin, 'last_run'),
    readMeta(admin, 'plan'),
  ]);
  const budgets: SweepProgress['budgets'] = { 'sweep-overpass': null, 'sweep-terrain': null };
  for (const b of (budgetRows.data ?? []) as Array<{ key: string; count: number; window_start: string }>) {
    budgets[b.key.replace('golf-provider:', '')] = { count: b.count, window_start: b.window_start };
  }
  return {
    ok: true,
    cells,
    courses,
    elevation: { done: elevDone.count ?? 0, due: Array.isArray(elevDue.data) ? elevDue.data.length : 0, dueCapped: Array.isArray(elevDue.data) && elevDue.data.length >= PAGE },
    hydrationDue: hydr.count ?? 0,
    budgets,
    next,
    lastRun,
    plan,
  };
}
