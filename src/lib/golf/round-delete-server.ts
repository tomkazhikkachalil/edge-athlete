import type { SupabaseClient } from '@supabase/supabase-js';
import { deletePostCascade } from '@/lib/posts/delete-post-server';
import { deletePerformancesBySource } from '@/lib/performance/write-server';
import { setResultHidden } from '@/lib/results/hide-server';

export type RoundDeleteResult =
  | { status: 'deleted' }
  /** Results-kept (241): the round had scores — the creator's post and mirror are hidden, nothing is deleted. */
  | { status: 'hidden' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

/**
 * Delete a round COMPLETELY: the group post (children cascade — participants,
 * media links, scorecard, participant + hole scores), its feed post (through
 * the same storage-safe cascade the post trash uses), and its golf_rounds
 * stat mirrors. This is the ONLY sanctioned way to delete a round — deleting
 * just the posts row orphans a live round that keeps resolving at /live,
 * showing in Live Now, and feeding stats/handicap through the mirror.
 *
 * Runs on the ADMIN client with an explicit creator check (house pattern:
 * authz in app code, not RLS — src/app/api/CLAUDE.md). Order matters: both
 * posts.group_post_id and golf_rounds.group_post_id are ON DELETE SET NULL,
 * so everything is captured/removed BEFORE the group_posts row goes.
 */
export async function deleteRoundCascade(
  admin: SupabaseClient,
  groupPostId: string,
  requesterId: string
): Promise<RoundDeleteResult> {
  const { data: round, error: fetchError } = await admin
    .from('group_posts')
    .select('id, creator_id, post_id')
    .eq('id', groupPostId)
    .maybeSingle();
  if (fetchError) {
    console.error('[ROUND-DELETE] fetch failed:', fetchError);
    return { status: 'error', message: 'Could not load the round' };
  }
  if (!round) return { status: 'not_found' };
  if (round.creator_id !== requesterId) return { status: 'forbidden' };

  // Stat mirrors first — after the group_posts delete their FK is nulled and
  // the rows become unfindable (they would go on feeding trends/handicap).
  // Their ids first: the performance rows (F4) are keyed by them.
  const { data: mirrorRows } = await admin
    .from('golf_rounds')
    .select('id')
    .eq('group_post_id', groupPostId);
  const { error: mirrorError } = await admin
    .from('golf_rounds')
    .delete()
    .eq('group_post_id', groupPostId);
  if (mirrorError) {
    console.error('[ROUND-DELETE] mirror cleanup failed:', mirrorError);
    return { status: 'error', message: 'Could not remove the round from stats' };
  }
  await deletePerformancesBySource(admin, 'golf_rounds', (mirrorRows ?? []).map(r => r.id as string));

  // The feed post, through the same storage-safe cascade as the post trash.
  if (round.post_id) {
    const postResult = await deletePostCascade(admin, round.post_id);
    if (!postResult.ok) {
      return { status: 'error', message: postResult.error };
    }
  }

  // The round itself. count: 'exact' — a 0-row delete must be an error, not
  // a silent success (the original DELETE route's exact bug).
  const { count, error: deleteError } = await admin
    .from('group_posts')
    .delete({ count: 'exact' })
    .eq('id', groupPostId);
  if (deleteError) {
    console.error('[ROUND-DELETE] group_posts delete failed:', deleteError);
    return { status: 'error', message: 'Failed to delete the round' };
  }
  if (!count) return { status: 'not_found' };

  return { status: 'deleted' };
}

/**
 * Results-kept round (241, Tom: "hide only, no delete"): what a creator's
 * "delete round" does. A round NOBODY has scored is deleted for real (no data
 * — an invitation that never happened). A round with ANY score — the
 * creator's own included — or an event round is HIDDEN instead: the round's
 * post and the creator's own mirror leave the creator's profile; every
 * score, every partner's mirror, the handicap and the dataset stay.
 */
export async function deleteOrHideRound(admin: SupabaseClient, groupPostId: string, requesterId: string): Promise<RoundDeleteResult> {
  const { data: round, error } = await admin.from('group_posts').select('id, creator_id, post_id, sport_event_round_id').eq('id', groupPostId).maybeSingle();
  if (error) {
    console.error('[ROUND-DELETE] fetch failed:', error);
    return { status: 'error', message: 'Could not load the round' };
  }
  if (!round) return { status: 'not_found' };
  if (round.creator_id !== requesterId) return { status: 'forbidden' };

  const { data: parts } = await admin.from('group_post_participants').select('id').eq('group_post_id', groupPostId);
  const ids = ((parts ?? []) as { id: string }[]).map(p => p.id);
  const { data: scored } = ids.length > 0
    ? await admin.from('golf_participant_scores').select('id, holes_completed, total_score').in('participant_id', ids)
    : { data: [] as { id: string; holes_completed: number | null; total_score: number | null }[] };
  const { count: mirrors } = await admin.from('golf_rounds').select('id', { count: 'exact', head: true }).eq('group_post_id', groupPostId);
  const hasScores = ((scored ?? []) as { holes_completed: number | null; total_score: number | null }[]).some(s => (s.holes_completed ?? 0) > 0 || s.total_score != null);

  if (!hasScores && (mirrors ?? 0) === 0 && !round.sport_event_round_id) return deleteRoundCascade(admin, groupPostId, requesterId);

  if (round.post_id) {
    const hid = await setResultHidden(admin, { kind: 'post', id: round.post_id as string }, true, requesterId);
    if (!hid.ok && hid.status !== 404) return { status: 'error', message: hid.error };
  }
  const { data: own } = await admin.from('golf_rounds').select('id').eq('group_post_id', groupPostId).eq('profile_id', requesterId);
  for (const r of (own ?? []) as { id: string }[]) await setResultHidden(admin, { kind: 'golf_round', id: r.id }, true, requesterId);
  return { status: 'hidden' };
}
