import type { ResultProvenance } from '@/lib/orgs/provenance';

/**
 * The common performance shape — data foundation, F3 (Sep 13 2026).
 *
 * ONE queryable table (`athlete_performances`, migration 194) of athletic
 * performances, one row per EVENT per athlete, fed by every existing
 * writer and read first by the scout search. `docs/PERFORMANCE_DATA.md`
 * is the reference; the invariants in one breath:
 *
 *  • ONE FACT PER EVENT — a golf league result is an OVERLAY on the
 *    round's row (contest, provenance, dispute, who entered it), never a
 *    second row.
 *  • `natural_key` is the ORIGIN ROW id, never (contest, profile): a
 *    stub-profile claim re-points `profile_id` and would orphan a
 *    composite key. Every writer is an idempotent upsert on it.
 *  • `metrics` is NUMERIC-ONLY, in the sport's stat-schema vocabulary.
 *  • The writer never blocks or fails the user's write (write-server.ts).
 *
 * This file is pure and client-safe (types + key helpers only).
 */

/** How the fact entered the dataset. (`golf_sync` was in the plan; no row
 *  would ever carry it — a league round's origin stays the round and the
 *  league is its overlay.) */
export const PERFORMANCE_SOURCES = ['post', 'live_round', 'org_entry', 'import'] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

export type PerformanceSourceTable = 'posts' | 'golf_rounds' | 'contest_stat_lines';

export type DisputeStatus = 'none' | 'disputed' | 'resolved';

/** The league's overlay on a golf round's row (the sync / the manager's
 *  confirm write it; a round edit never touches these keys). */
export interface PerformanceOverlay {
  contest_id: string;
  provenance: ResultProvenance;
  dispute_status: DisputeStatus;
  entered_by: string | null;
}

/** The columns every writer sends. The overlay keys are OPTIONAL on
 *  purpose: a PostgREST upsert updates only the columns in the payload,
 *  so a row written without them leaves an existing overlay untouched
 *  (`provenance DEFAULT 'self_reported'` carries the first write). */
export interface PerformanceRow extends Partial<PerformanceOverlay> {
  profile_id: string;
  sport_key: string;
  occurred_on: string; // YYYY-MM-DD
  source: PerformanceSource;
  source_table: PerformanceSourceTable;
  source_id: string;
  natural_key: string;
  metrics: Record<string, number>;
  context: Record<string, unknown> | null;
  headline: number | null;
}

export const naturalKey = {
  post: (postId: string): string => `post:${postId}`,
  golfRound: (roundId: string): string => `golf_round:${roundId}`,
  contestStatLine: (lineId: string): string => `contest_stat_line:${lineId}`,
} as const;

/** Which way a better headline points. The column stores the number; the
 *  rank is the reader's (the scout search orders by this). */
export type HeadlineDirection = 'lower' | 'higher';
export const HEADLINE_DIRECTION: Readonly<Record<string, HeadlineDirection>> = {
  golf: 'lower',
  track_field: 'lower',
};
export const headlineDirection = (sportKey: string): HeadlineDirection => HEADLINE_DIRECTION[sportKey] ?? 'higher';

/** The date part of a timestamp — `occurred_on` for a fact whose origin
 *  carries no date of its own (a stat-line post without one). */
export const dateOnly = (iso: string): string => iso.slice(0, 10);
