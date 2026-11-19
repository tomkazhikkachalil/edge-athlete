// ── The ONE Finish writer (Drafts round PR 3, Oct 2026) ──────────────────────
// Finish and Post are two actions. FINISH is this: the round's status goes
// pending | active → completed (guarded — two taps finish once), then the
// record is written (the mirror into golf_rounds, the media onto the post).
// It never touches the post's status or timestamp: the post stays a DRAFT
// until the owner POSTS it (publish-server.ts). Callers: the creator's
// explicit Finish (PATCH /api/group-posts/[id] status completed), the reopen
// prompt and the Drafts list (the same PATCH), and the daily sweep's 7-day
// rule. The score routes keep their own path: advanceRoundStatus completes a
// round when every card is full, and they mirror right after it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound, mirrorRoundMedia } from './round-mirror';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export type FinishOutcome =
  | { status: 'finished' }
  /** Already completed (or cancelled): the record was written before; nothing to do. */
  | { status: 'already' }
  | { status: 'error'; message: string };

/** `statusWritten`: the caller has ALREADY set the round to completed (the
 *  creator's PATCH writes it under RLS, which is its permission check). The
 *  guarded update below then matches nothing, and until Nov 19 2026 that
 *  returned 'already' BEFORE the record was written: a round finished by hand
 *  never reached golf_rounds (found on staging while tracing Tom's list). With
 *  the flag the record is written whenever the round is completed. */
export async function finishRound(admin: Admin, groupPostId: string, opts: { statusWritten?: boolean } = {}): Promise<FinishOutcome> {
  const { data: rows, error } = await admin
    .from('group_posts')
    .update({ status: 'completed' })
    .eq('id', groupPostId)
    .in('status', ['pending', 'active'])
    .select('id');
  if (error) {
    console.error('[FINISH] status write failed:', error.message);
    return { status: 'error', message: 'Could not finish the round' };
  }
  if (!rows || rows.length === 0) {
    if (!opts.statusWritten) return { status: 'already' };
    // The mirror gates itself on 'completed', so a cancelled round writes nothing.
    await mirrorCompletedRound(admin, groupPostId);
    await mirrorRoundMedia(admin, groupPostId);
    return { status: 'finished' };
  }
  // The record: every scoring player's golf_rounds row, then the round's
  // media onto its (draft) post. Best-effort, self-gated on 'completed'.
  await mirrorCompletedRound(admin, groupPostId);
  await mirrorRoundMedia(admin, groupPostId);
  return { status: 'finished' };
}
