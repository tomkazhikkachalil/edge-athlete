// ── The daily round sweep: the 7-day rule (Drafts round PR 3, Oct 2026) ──────
// advanceRoundStatus only runs when someone WRITES a score, so a round that
// is simply abandoned mid-way stays 'active' in the database forever; a
// round nobody ever scored stays 'pending'. Nothing finishes at read time any
// more (the 6 h quiet rule is gone — a quiet round used to surface on the
// feed six hours later), so this sweep is the ONE place an untouched round
// is settled, and it settles it Tom's way (Oct 6 2026):
//   • ACTIVE and untouched for ABANDON_AFTER_MS → FINISHED as played
//     (round-finish.ts: the scores become the record — golf_rounds, the
//     handicap, the dataset). Its post stays a DRAFT. Nothing is ever posted
//     by this sweep.
//   • PENDING (no score at all) and untouched for ABANDON_AFTER_MS →
//     DISCARDED (the results delete cascade, as the creator would): nothing
//     was recorded, so there is nothing to keep.
//   • An event's round (203) is never touched — its lifecycle is the event's.
// Best-effort per round: one bad round must not stop the rest.

import type { SupabaseClient } from '@supabase/supabase-js';
import { abandonedRoundAction } from './round-status';
import { finishRound } from './round-finish';
import { deleteRoundCascade } from './round-delete-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** Cap per run so a backlog can't blow the cron's time budget. */
export const ROUND_SWEEP_LIMIT = 200;

export interface RoundSweepResult {
  examined: number;
  /** Active rounds finished as played (the record written; the post a draft). */
  finished: number;
  /** Scoreless pending rounds discarded (nothing was recorded). */
  discarded: number;
  failed: number;
}

interface SweepRow {
  id: string;
  status: string | null;
  created_at: string | null;
  creator_id: string;
  sport_event_round_id: string | null;
  participants?: Array<{ scores: { updated_at: string | null } | Array<{ updated_at: string | null }> | null }> | null;
}

function lastActivityOf(row: SweepRow): string | null {
  let last: string | null = null;
  for (const p of row.participants ?? []) {
    const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    if (s?.updated_at && (!last || s.updated_at > last)) last = s.updated_at;
  }
  return last;
}

export async function runRoundSweep(admin: Admin, now: number = Date.now()): Promise<RoundSweepResult> {
  const result: RoundSweepResult = { examined: 0, finished: 0, discarded: 0, failed: 0 };

  const { data: rounds, error } = await admin
    .from('group_posts')
    .select('id, status, created_at, creator_id, sport_event_round_id, participants:group_post_participants ( scores:golf_participant_scores ( updated_at ) )')
    .eq('type', 'golf_round')
    .in('status', ['pending', 'active'])
    .is('sport_event_round_id', null)
    .order('created_at', { ascending: true })
    .limit(ROUND_SWEEP_LIMIT);

  if (error) {
    console.error('[ROUND SWEEP] fetch failed:', error);
    return result;
  }

  for (const round of (rounds ?? []) as SweepRow[]) {
    const action = abandonedRoundAction(
      { status: round.status, createdAt: round.created_at, lastActivityAt: lastActivityOf(round), sportEventRoundId: round.sport_event_round_id },
      now,
    );
    if (!action) continue;
    result.examined += 1;
    try {
      if (action === 'finish') {
        const out = await finishRound(admin, round.id);
        if (out.status === 'error') throw new Error(out.message);
        if (out.status === 'finished') result.finished += 1;
      } else {
        // As the creator would: the whole round, nothing recorded.
        const out = await deleteRoundCascade(admin, round.id, round.creator_id);
        if (out.status === 'deleted') result.discarded += 1;
        else throw new Error(`discard answered ${out.status}`);
      }
    } catch (e) {
      result.failed += 1;
      console.error(`[ROUND SWEEP] round ${round.id} (${action}) failed:`, e);
    }
  }

  return result;
}
