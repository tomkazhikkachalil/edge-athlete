// ── Quiet live-round sweep ────────────────────────────────────────────────────
// advanceRoundStatus only runs when someone WRITES a score, so a round that is
// simply abandoned mid-way stays 'active' in the database forever. The display
// layer copes — effectiveRoundStatus applies the 6h quiet rule at read time, so
// nothing shows as LIVE — but the row never reaches 'completed', and that has a
// real consequence: mirrorCompletedRound requires 'completed', so an abandoned
// round's scores never become golf_rounds rows and are therefore missing from
// trends, handicap and the rounds list. Permanently.
//
// This sweep re-evaluates quiet rounds on the daily cron and lets the existing
// state machine finish the job. Best-effort per round: one bad round must not
// stop the rest.

import type { SupabaseClient } from '@supabase/supabase-js';
import { advanceRoundStatus, isAbandonedPendingRound } from './round-status';
import { mirrorCompletedRound, mirrorRoundMedia } from './round-mirror';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** Cap per run so a backlog can't blow the cron's time budget. */
export const ROUND_SWEEP_LIMIT = 200;

export interface RoundSweepResult {
  examined: number;
  completed: number;
  /** Started-but-never-scored rounds retired to 'cancelled' (dummy-proofing
   *  round). Data kept; feed never shows them; owner can still delete. */
  cancelled: number;
  failed: number;
}

export async function runRoundSweep(admin: Admin): Promise<RoundSweepResult> {
  const result: RoundSweepResult = { examined: 0, completed: 0, cancelled: 0, failed: 0 };

  const { data: rounds, error } = await admin
    .from('group_posts')
    .select('id')
    .eq('type', 'golf_round')
    .eq('status', 'active')
    .limit(ROUND_SWEEP_LIMIT);

  if (error) {
    console.error('[ROUND SWEEP] fetch failed:', error);
    return result;
  }

  for (const round of rounds ?? []) {
    result.examined += 1;
    try {
      // advanceRoundStatus owns the quiet rule and the hole-count rule; this
      // just gives it a reason to run. It no-ops on a round that is still
      // genuinely live.
      await advanceRoundStatus(admin, round.id);

      const { data: after } = await admin
        .from('group_posts')
        .select('status')
        .eq('id', round.id)
        .maybeSingle();

      if (after?.status === 'completed') {
        result.completed += 1;
        // advanceRoundStatus already mirrors on the score-write path; on the
        // sweep path nothing else will, so do it here.
        await mirrorCompletedRound(admin, round.id);
        await mirrorRoundMedia(admin, round.id);
      }
    } catch (e) {
      result.failed += 1;
      console.error(`[ROUND SWEEP] round ${round.id} failed:`, e);
    }
  }

  // ── Abandoned scoreless rounds ──
  // A 'pending' round never advances (advanceRoundStatus needs a score) and
  // was previously never swept — it sat forever. Once its 48h live window
  // passes it retires to 'cancelled': hidden from every surface, nothing
  // destroyed (Tom's keep-data decision). The status guard on the update
  // makes a concurrent first-score write (pending→active) win the race.
  const { data: stale, error: staleError } = await admin
    .from('group_posts')
    .select('id, status, date')
    .eq('type', 'golf_round')
    .eq('status', 'pending')
    .limit(ROUND_SWEEP_LIMIT);

  if (staleError) {
    console.error('[ROUND SWEEP] pending fetch failed:', staleError);
    return result;
  }

  for (const round of stale ?? []) {
    if (!isAbandonedPendingRound(round)) continue;
    result.examined += 1;
    try {
      const { error: cancelError } = await admin
        .from('group_posts')
        .update({ status: 'cancelled' })
        .eq('id', round.id)
        .eq('status', 'pending');
      if (cancelError) throw cancelError;
      result.cancelled += 1;
    } catch (e) {
      result.failed += 1;
      console.error(`[ROUND SWEEP] cancel of pending round ${round.id} failed:`, e);
    }
  }

  return result;
}
