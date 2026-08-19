import type { SupabaseClient } from '@supabase/supabase-js';
import { deletePostCascade } from '@/lib/posts/delete-post-server';

export type RoundDeleteResult =
  | { status: 'deleted' }
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
  const { error: mirrorError } = await admin
    .from('golf_rounds')
    .delete()
    .eq('group_post_id', groupPostId);
  if (mirrorError) {
    console.error('[ROUND-DELETE] mirror cleanup failed:', mirrorError);
    return { status: 'error', message: 'Could not remove the round from stats' };
  }

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
