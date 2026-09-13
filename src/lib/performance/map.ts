import { scoreDifferential } from '@/lib/golf/handicap';
import type { ResultProvenance } from '@/lib/orgs/provenance';
import { getStatSchema, isStatLineData } from '@/lib/sports/stat-schemas';
import { validateStatLine } from '@/lib/sports/stat-line-validate';
import { isUuid } from '@/lib/uuid';
import { dateOnly, naturalKey, type PerformanceOverlay, type PerformanceRow } from './types';

/**
 * The pure mappers from each origin row to the common shape — data
 * foundation, F3 (Sep 13 2026). Every mapper answers `null` when the
 * origin holds no fact worth a row (no score, no finite stat, a pending
 * post, a sport without a schema) — the writer then DELETES the key, so
 * the table never keeps a fact its origin lost. No I/O here; the writer
 * (`write-server.ts`) and the backfill (F5) call these.
 */

const finiteNumbers = (stats: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
};

const compact = (obj: Record<string, unknown>): Record<string, unknown> | null => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
};

// ── Stat-line posts ─────────────────────────────────────────────────────────

export interface StatLinePostOrigin {
  id: string;
  profile_id: string;
  sport_key: string;
  created_at: string;
  status?: string | null;
  created_by_user_id?: string | null;
  stats_data: unknown;
}

/** A self-entered stat line → one row. `null` when the post is not a stat
 *  line, is pending a guardian's approval, fails the sport's schema (the
 *  400 the route answers — a backfilled legacy row may still fail), or
 *  carries no finite stat. `occurred_on` is the line's date, else the day
 *  the post was created. */
export function fromStatLinePost(post: StatLinePostOrigin): PerformanceRow | null {
  if (post.status === 'pending_approval') return null;
  if (!isStatLineData(post.stats_data)) return null;
  const checked = validateStatLine(post.stats_data, post.sport_key, '9999-12-31');
  if (!checked.ok) return null;
  const schema = getStatSchema(post.sport_key);
  if (!schema) return null;
  const line = checked.value;
  const metrics = finiteNumbers(line.stats);
  if (Object.keys(metrics).length === 0) return null;
  return {
    profile_id: post.profile_id,
    sport_key: post.sport_key,
    occurred_on: line.date ?? dateOnly(post.created_at),
    source: 'post',
    source_table: 'posts',
    source_id: post.id,
    natural_key: naturalKey.post(post.id),
    metrics,
    context: compact({ opponent: line.opponent, result: line.result, result_score: line.result_score }),
    headline: schema.heroStat.compute(metrics),
  };
}

// ── Golf rounds ─────────────────────────────────────────────────────────────

export interface GolfRoundOrigin {
  id: string;
  profile_id: string;
  date: string;
  holes: number | null;
  par: number | null;
  gross_score: number | null;
  total_putts?: number | null;
  fir_percentage?: number | null;
  gir_percentage?: number | null;
  course_rating?: number | null;
  slope_rating?: number | null;
  course_id?: string | null;
  course?: string | null;
  tee?: string | null;
  group_post_id?: string | null;
}

/** A golf round → one row; `null` without a positive gross (a round in
 *  progress, a scorecard not yet totalled). The differential is stored
 *  ONLY when the round carries a rating AND a slope (handicap.ts's exact
 *  formula) — never estimated. The league overlay, when given, rides the
 *  same row; when omitted the overlay keys are ABSENT so an edit's
 *  re-upsert leaves an existing overlay untouched. */
export function fromGolfRound(round: GolfRoundOrigin, overlay?: PerformanceOverlay): PerformanceRow | null {
  const gross = round.gross_score;
  if (typeof gross !== 'number' || !Number.isFinite(gross) || gross <= 0) return null;
  const metrics: Record<string, number> = { gross };
  if (typeof round.holes === 'number' && round.holes > 0) metrics.holes = round.holes;
  if (typeof round.par === 'number' && round.par > 0) metrics.to_par = gross - round.par;
  if (typeof round.total_putts === 'number' && round.total_putts > 0) metrics.putts = round.total_putts;
  if (typeof round.fir_percentage === 'number') metrics.fir_pct = round.fir_percentage;
  if (typeof round.gir_percentage === 'number') metrics.gir_pct = round.gir_percentage;
  if (
    typeof round.course_rating === 'number' && round.course_rating > 0 &&
    typeof round.slope_rating === 'number' && round.slope_rating > 0
  ) metrics.differential = scoreDifferential(gross, round.course_rating, round.slope_rating);
  const row: PerformanceRow = {
    profile_id: round.profile_id,
    sport_key: 'golf',
    occurred_on: dateOnly(round.date),
    source: round.group_post_id ? 'live_round' : 'post',
    source_table: 'golf_rounds',
    source_id: round.id,
    natural_key: naturalKey.golfRound(round.id),
    metrics,
    context: compact({ course_id: round.course_id, course: round.course, tee: round.tee }),
    headline: gross,
  };
  return overlay ? { ...row, ...overlay } : row;
}

// ── Org-entered stat lines ──────────────────────────────────────────────────

export interface ContestStatLineOrigin {
  id: string;
  contest_id: string;
  profile_id: string;
  stats: unknown;
  provenance: ResultProvenance;
  entered_by: string | null;
  created_at: string;
}

/** A console-entered line (157) → one row with the org's provenance
 *  VERBATIM; an imported line's source is `import`. `occurredOn` is the
 *  contest's day (the caller reads `contests.scheduled_at`), else the
 *  line's creation day. */
export function fromContestStatLine(line: ContestStatLineOrigin, sportKey: string, occurredOn: string | null): PerformanceRow | null {
  const schema = getStatSchema(sportKey);
  if (!schema) return null;
  if (!line.stats || typeof line.stats !== 'object') return null;
  const metrics = finiteNumbers(line.stats as Record<string, unknown>);
  if (Object.keys(metrics).length === 0) return null;
  return {
    profile_id: line.profile_id,
    sport_key: sportKey,
    occurred_on: occurredOn ? dateOnly(occurredOn) : dateOnly(line.created_at),
    source: line.provenance === 'imported' ? 'import' : 'org_entry',
    source_table: 'contest_stat_lines',
    source_id: line.id,
    natural_key: naturalKey.contestStatLine(line.id),
    contest_id: line.contest_id,
    provenance: line.provenance,
    dispute_status: 'none',
    entered_by: line.entered_by,
    metrics,
    context: null,
    headline: schema.heroStat.compute(metrics),
  };
}

// ── The golf league's overlay ───────────────────────────────────────────────

export interface ContestResultOrigin {
  contest_id: string;
  provenance: ResultProvenance;
  dispute_status?: string | null;
  entered_by?: string | null;
  payload: unknown;
}

/** The golf sync's `contest_results` row names the member's round in
 *  `payload.roundRef.roundId` — that round's row takes the league overlay.
 *  Non-golf results are team-scoped and name no athlete: `null`. */
export function golfOverlayFromResult(result: ContestResultOrigin): { roundId: string; overlay: PerformanceOverlay } | null {
  const ref = (result.payload as { roundRef?: { roundId?: unknown } } | null)?.roundRef;
  const roundId = ref?.roundId;
  if (typeof roundId !== 'string' || !isUuid(roundId)) return null;
  const dispute = result.dispute_status;
  return {
    roundId,
    overlay: {
      contest_id: result.contest_id,
      provenance: result.provenance,
      dispute_status: dispute === 'disputed' || dispute === 'resolved' ? dispute : 'none',
      entered_by: result.entered_by ?? null,
    },
  };
}

// ── Batch shape ─────────────────────────────────────────────────────────────

/** PostgREST takes a batch's columns from its rows' keys, so a batch must
 *  be UNIFORM: rows with and without the overlay keys go in separate
 *  upserts (otherwise the missing keys would write NULLs over an overlay).
 *  Groups by the sorted key set; order within a group is kept. */
export function groupUniformRows<T extends object>(rows: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const sig = Object.keys(row).sort().join(',');
    const g = groups.get(sig);
    if (g) g.push(row);
    else groups.set(sig, [row]);
  }
  return [...groups.values()];
}
