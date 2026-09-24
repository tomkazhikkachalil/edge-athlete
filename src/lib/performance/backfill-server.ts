import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { isStatLineData } from '@/lib/sports/stat-schemas';
import {
  countSkip,
  cursorAfterPage,
  emptySummary,
  encodeCursor,
  keysetAfter,
  MAX_PAGES,
  PAGE_SIZE,
  type BackfillSource,
  type BackfillSummary,
  type Cursor,
} from './backfill';
import {
  fromContestStatLine,
  fromGolfRound,
  fromStatLinePost,
  golfOverlayFromResult,
  type ContestResultOrigin,
  type ContestStatLineOrigin,
  type GolfRoundOrigin,
  type StatLinePostOrigin,
} from './map';
import type { PerformanceRow } from './types';
import { GOLF_ROUND_ORIGIN_SELECT, upsertPerformances } from './write-server';

/**
 * The performance backfill's I/O half — data foundation, F5 (Sep 13 2026).
 * Server-only (service role). One SOURCE per call, keyset-paged, at most
 * `MAX_PAGES` pages of `PAGE_SIZE`; idempotent by `natural_key`. A dry run
 * reads and maps but writes nothing — it never touches the target table,
 * so it works pre-194 too. See `backfill.ts` for the cursor and the run
 * order; `docs/PERFORMANCE_DATA.md` for the contract.
 */

const TAG = '[performance-backfill]';

type Admin = SupabaseClient<any, 'public', any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the house admin alias; the joins below are untyped

export type BackfillOutcome =
  | { ok: true; summary: BackfillSummary }
  | { ok: false; error: 'missing_table' | 'read_failed' };

interface Page {
  rows: PerformanceRow[];
  /** The page's origin rows, for the cursor. */
  origins: { created_at: string; id: string }[];
}

type PageReader = (admin: Admin, after: Cursor | null, summary: BackfillSummary) => Promise<Page | null>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the builder's row type is the untyped admin alias's
type Builder = ReturnType<ReturnType<Admin['from']>['select']> & { eq: (col: string, v: string) => any; or: (f: string) => any };

const paged = <T extends { created_at: string; id: string }>(
  admin: Admin,
  table: string,
  select: string,
  after: Cursor | null,
  refine: (b: Builder) => Builder = b => b
) => {
  let s = refine(admin.from(table).select(select) as unknown as Builder);
  // Both cursor values were validated by decodeCursor (an ISO timestamp
  // and a uuid) — nothing user-shaped reaches the filter string.
  if (after) s = s.or(keysetAfter(after)); // hardening-ok: values validated by decodeCursor
  return s.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE_SIZE) as unknown as PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>;
};

const readGolfRounds: PageReader = async (admin, after, summary) => {
  const { data, error } = await paged<GolfRoundOrigin & { created_at: string }>(admin, 'golf_rounds', `${GOLF_ROUND_ORIGIN_SELECT}, created_at`, after);
  if (error) {
    console.warn(`${TAG} golf_rounds read failed:`, error.code, error.message);
    return null;
  }
  const rows: PerformanceRow[] = [];
  for (const r of data ?? []) {
    const row = fromGolfRound(r);
    if (row) rows.push(row);
    else countSkip(summary, 'no_gross');
  }
  return { rows, origins: data ?? [] };
};

const readPosts: PageReader = async (admin, after, summary) => {
  const { data, error } = await paged<StatLinePostOrigin & { created_at: string }>(
    admin,
    'posts',
    'id, profile_id, sport_key, created_at, status, stats_data, created_by_user_id',
    after,
    b => b.eq('stats_data->>type', 'stat_line')
  );
  if (error) {
    console.warn(`${TAG} posts read failed:`, error.code, error.message);
    return null;
  }
  const rows: PerformanceRow[] = [];
  for (const p of data ?? []) {
    const row = fromStatLinePost(p);
    if (row) rows.push(row);
    else if (p.status === 'pending_approval') countSkip(summary, 'pending_approval');
    else if (!isStatLineData(p.stats_data)) countSkip(summary, 'not_a_stat_line');
    else countSkip(summary, 'failed_schema');
  }
  return { rows, origins: data ?? [] };
};

interface StatLineJoined extends ContestStatLineOrigin {
  contest: { scheduled_at: string | null; competition: { sport_key: string } | { sport_key: string }[] | null } | { scheduled_at: string | null; competition: { sport_key: string } | { sport_key: string }[] | null }[] | null;
}

const readContestStatLines: PageReader = async (admin, after, summary) => {
  const { data, error } = await paged<StatLineJoined>(
    admin,
    'contest_stat_lines',
    'id, contest_id, profile_id, stats, provenance, entered_by, created_at, contest:contest_id (scheduled_at, competition:competition_id (sport_key))',
    after
  );
  if (error) {
    console.warn(`${TAG} contest_stat_lines read failed:`, error.code, error.message);
    return null;
  }
  const rows: PerformanceRow[] = [];
  for (const l of data ?? []) {
    const contest = Array.isArray(l.contest) ? l.contest[0] : l.contest;
    const compRaw = contest?.competition;
    const comp = Array.isArray(compRaw) ? compRaw[0] : compRaw;
    if (!comp?.sport_key) {
      countSkip(summary, 'no_sport');
      continue;
    }
    const row = fromContestStatLine(l, comp.sport_key, contest?.scheduled_at ?? null);
    if (row) rows.push(row);
    else countSkip(summary, 'no_finite_stat_or_schema');
  }
  return { rows, origins: data ?? [] };
};

const readContestResults: PageReader = async (admin, after, summary) => {
  const { data, error } = await paged<ContestResultOrigin & { id: string; created_at: string }>(
    admin,
    'contest_results',
    'id, contest_id, provenance, dispute_status, entered_by, payload, created_at',
    after
  );
  if (error) {
    console.warn(`${TAG} contest_results read failed:`, error.code, error.message);
    return null;
  }
  const overlays = new Map<string, ReturnType<typeof golfOverlayFromResult>>();
  for (const r of data ?? []) {
    const o = golfOverlayFromResult(r);
    if (o) overlays.set(o.roundId, o);
    else countSkip(summary, 'no_round_ref');
  }
  const rows: PerformanceRow[] = [];
  if (overlays.size > 0) {
    const { data: rounds, error: roundsError } = await admin
      .from('golf_rounds')
      .select(GOLF_ROUND_ORIGIN_SELECT)
      .in('id', [...overlays.keys()]);
    if (roundsError) {
      console.warn(`${TAG} rounds read failed:`, roundsError.code, roundsError.message);
      return null;
    }
    const byId = new Map((rounds ?? []).map(r => [r.id as string, r as unknown as GolfRoundOrigin]));
    for (const [roundId, o] of overlays) {
      const round = byId.get(roundId);
      if (!round) {
        countSkip(summary, 'round_missing');
        continue;
      }
      const row = fromGolfRound(round, o!.overlay);
      if (row) rows.push(row);
      else countSkip(summary, 'no_gross');
    }
  }
  return { rows, origins: data ?? [] };
};

const READERS: Record<BackfillSource, PageReader> = {
  golf_rounds: readGolfRounds,
  posts: readPosts,
  contest_stat_lines: readContestStatLines,
  contest_results: readContestResults,
};

export async function runPerformanceBackfill(
  admin: Admin,
  opts: { source: BackfillSource; cursor: Cursor | null; dryRun: boolean }
): Promise<BackfillOutcome> {
  const summary = emptySummary(opts.source, opts.dryRun);
  let after = opts.cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await READERS[opts.source](admin, after, summary);
    if (!result) return { ok: false, error: 'read_failed' };
    summary.scanned += result.origins.length;
    summary.mapped += result.rows.length;
    if (!opts.dryRun && result.rows.length > 0) {
      const written = await upsertPerformances(admin, result.rows);
      if (!written.ok) {
        if (written.skipped === 'missing_table') return { ok: false, error: 'missing_table' };
        return { ok: false, error: 'read_failed' };
      }
      summary.upserted += written.count;
    }
    after = cursorAfterPage(result.origins);
    if (!after) return { ok: true, summary };
  }
  summary.truncated = true;
  summary.nextCursor = encodeCursor(after!);
  return { ok: true, summary };
}

/** Exposed for the route's 409 copy. */
export const isMissingTable = (code: string | undefined | null): boolean => isMissingTableError(code);
