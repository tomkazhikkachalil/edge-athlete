import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { fromGolfRound, groupUniformRows, type GolfRoundOrigin } from './map';
import { afterPerformanceWrite, type AfterWriteMode } from '@/lib/play/after-write';
import type { MatchOutcomeEntry } from './match-outcomes';
import { contextKey, naturalKey, type PerformanceOverlay, type PerformanceRow, type PerformanceSourceTable } from './types';

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

/** `after`: the Play program's post-write hook (244) — 'notify' for a live
 *  write (the default), 'silent' for the backfill (history earns badges
 *  without bells), 'none' to skip it. */
export async function upsertPerformances(
  admin: SupabaseClient,
  rows: readonly PerformanceRow[],
  opts: { after?: AfterWriteMode | 'none' } = {}
): Promise<WriteOutcome> {
  if (rows.length === 0) return { ok: true, count: 0 };
  let count = 0;
  try {
    for (const group of groupUniformRows(rows)) {
      const { error } = await admin.from('athlete_performances').upsert(group, { onConflict: 'natural_key' });
      const o = outcomeOf(error, group.length, 'upsert');
      if (!o.ok) return o;
      count += group.length;
    }
    const after = opts.after ?? 'notify';
    if (after !== 'none') await afterPerformanceWrite(admin, rows, after);
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
  'id, profile_id, date, holes, par, gross_score, total_putts, fir_percentage, gir_percentage, course_rating, slope_rating, course_id, course, tee, group_post_id, hole_scores:golf_holes(par, strokes)';

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

/** 244 (the Play program): a completed match round's side + outcome onto
 *  its players' mirrored golf rows — the one place those two columns are
 *  written for golf (the mapper never sends them, so a later round edit
 *  keeps them). Scoped to the round's group post so a row is only ever
 *  stamped inside its own shared game. Never throws; always await. */
export async function stampMatchOutcomes(admin: SupabaseClient, groupPostId: string, entries: readonly MatchOutcomeEntry[]): Promise<WriteOutcome> {
  if (entries.length === 0) return { ok: true, count: 0 };
  try {
    const profileIds = [...new Set(entries.map(e => e.profileId))];
    const { data, error } = await admin.from('golf_rounds').select('id, profile_id').eq('group_post_id', groupPostId).in('profile_id', profileIds);
    if (error) return outcomeOf(error, 0, 'match outcome round read');
    const roundOf = new Map(((data ?? []) as Array<{ id: string; profile_id: string }>).map(r => [r.profile_id, r.id]));
    let count = 0;
    for (const e of entries) {
      const roundId = roundOf.get(e.profileId);
      if (!roundId) continue; // no mirrored card (an empty card, a hidden player's erase) — nothing to stamp
      const { error: upErr } = await admin
        .from('athlete_performances')
        .update({ side: e.side, outcome: e.outcome })
        .eq('natural_key', naturalKey.golfRound(roundId))
        .eq('context_key', contextKey.groupPost(groupPostId));
      const o = outcomeOf(upErr, 1, 'match outcome stamp');
      if (!o.ok) return o;
      count++;
    }
    return { ok: true, count };
  } catch (err) {
    console.warn(`${TAG} match outcome stamp threw:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
