import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { fromGolfRound, groupUniformRows, type GolfRoundOrigin } from './map';
import { naturalKey, type PerformanceOverlay, type PerformanceRow, type PerformanceSourceTable } from './types';

/**
 * The ONE writer of `athlete_performances` — data foundation, F3 (Sep 13
 * 2026). Server-only (service role; the table is posture A).
 *
 * The contract every hook site (F4) relies on:
 *  • NEVER throws and never fails the user's write. A missing table
 *    (pre-194: 42P01 / PGRST205) answers `{ skipped: 'missing_table' }`;
 *    any other error is a `console.warn('[performance] …')` and
 *    `{ ok: false }`. Always AWAIT a call — serverless kills fire-and-forget.
 *  • Idempotent: every write is an upsert on `natural_key`.
 *  • A batch is split into UNIFORM key sets (`groupUniformRows`) so a row
 *    written without the overlay keys never NULLs an existing overlay.
 */

const TAG = '[performance]';

export type WriteOutcome =
  | { ok: true; count: number }
  | { ok: false; skipped?: 'missing_table' };

const outcomeOf = (error: { code?: string; message?: string } | null, count: number, what: string): WriteOutcome => {
  if (!error) return { ok: true, count };
  if (isMissingTableError(error.code)) return { ok: false, skipped: 'missing_table' };
  console.warn(`${TAG} ${what} failed:`, error.code, error.message);
  return { ok: false };
};

export async function upsertPerformances(admin: SupabaseClient, rows: readonly PerformanceRow[]): Promise<WriteOutcome> {
  if (rows.length === 0) return { ok: true, count: 0 };
  let count = 0;
  try {
    for (const group of groupUniformRows(rows)) {
      const { error } = await admin.from('athlete_performances').upsert(group, { onConflict: 'natural_key' });
      const o = outcomeOf(error, group.length, 'upsert');
      if (!o.ok) return o;
      count += group.length;
    }
    return { ok: true, count };
  } catch (err) {
    console.warn(`${TAG} upsert threw:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export async function deletePerformancesByKeys(admin: SupabaseClient, keys: readonly string[]): Promise<WriteOutcome> {
  if (keys.length === 0) return { ok: true, count: 0 };
  try {
    const { error } = await admin.from('athlete_performances').delete().in('natural_key', [...keys]);
    return outcomeOf(error, keys.length, 'delete by key');
  } catch (err) {
    console.warn(`${TAG} delete threw:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export async function deletePerformancesBySource(
  admin: SupabaseClient,
  sourceTable: PerformanceSourceTable,
  sourceIds: readonly string[]
): Promise<WriteOutcome> {
  if (sourceIds.length === 0) return { ok: true, count: 0 };
  try {
    const { error } = await admin
      .from('athlete_performances')
      .delete()
      .eq('source_table', sourceTable)
      .in('source_id', [...sourceIds]);
    return outcomeOf(error, sourceIds.length, 'delete by source');
  } catch (err) {
    console.warn(`${TAG} delete threw:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

export const GOLF_ROUND_ORIGIN_SELECT =
  'id, profile_id, date, holes, par, gross_score, total_putts, fir_percentage, gir_percentage, course_rating, slope_rating, course_id, course, tee, group_post_id';

/** Re-read the round and project it — `gross_score` exists only after
 *  `calculate_round_stats`, so every golf hook calls this AFTER the RPC.
 *  A round without a score has no fact: its key is deleted. The overlay,
 *  when given, rides the same row (the league sync / confirm). */
export async function syncGolfRoundPerformance(
  admin: SupabaseClient,
  roundId: string,
  overlay?: PerformanceOverlay
): Promise<WriteOutcome> {
  try {
    const { data, error } = await admin.from('golf_rounds').select(GOLF_ROUND_ORIGIN_SELECT).eq('id', roundId).maybeSingle();
    if (error) {
      console.warn(`${TAG} round read failed:`, error.code, error.message);
      return { ok: false };
    }
    if (!data) return deletePerformancesByKeys(admin, [naturalKey.golfRound(roundId)]);
    const row = fromGolfRound(data as unknown as GolfRoundOrigin, overlay);
    if (!row) return deletePerformancesByKeys(admin, [naturalKey.golfRound(roundId)]);
    return upsertPerformances(admin, [row]);
  } catch (err) {
    console.warn(`${TAG} round sync threw:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
