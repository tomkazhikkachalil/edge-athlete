/**
 * Group rounds auto-tag their participants: the round's mirror feed post
 * carries participant profile IDs in posts.tags, which is what the Tagged
 * tab reads. Creation seeds the array; late participant add/remove calls
 * syncMirrorPostTags to recompute it authoritatively.
 *
 * posts.tags ONLY — post_tags inserts fire the tag-notification trigger,
 * and participants already receive round-invite notifications. An athlete
 * who untagged themself (post_tags status='removed' marker) stays removed
 * across resyncs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MirrorParticipant {
  profile_id: string;
  status: string;
}

/** Pure: dedupe, exclude the author, exclude declined, exclude untagged. */
export function deriveMirrorPostTags(
  participants: MirrorParticipant[],
  authorProfileId: string,
  removedProfileIds: string[] = []
): string[] {
  const removed = new Set(removedProfileIds);
  const tags = new Set<string>();
  for (const p of participants) {
    if (!p.profile_id) continue;
    if (p.profile_id === authorProfileId) continue;
    if (p.status === 'declined') continue;
    if (removed.has(p.profile_id)) continue;
    tags.add(p.profile_id);
  }
  return [...tags];
}

/**
 * Authoritative recompute of the mirror post's tags for one group post.
 * Idempotent and order-independent; safe to call after any participant
 * mutation. Callers treat failures as non-fatal (the participant mutation
 * is the primary contract) — this logs and returns rather than throwing.
 */
export async function syncMirrorPostTags(
  admin: SupabaseClient,
  groupPostId: string
): Promise<void> {
  try {
    const { data: mirrorPost } = await admin
      .from('posts')
      .select('id, profile_id')
      .eq('group_post_id', groupPostId)
      .maybeSingle();
    if (!mirrorPost) return; // no mirror post (legacy round) — nothing to sync

    const [{ data: participants }, { data: removedRows }] = await Promise.all([
      admin
        .from('group_post_participants')
        .select('profile_id, status')
        .eq('group_post_id', groupPostId),
      admin
        .from('post_tags')
        .select('tagged_profile_id')
        .eq('post_id', mirrorPost.id)
        .eq('status', 'removed'),
    ]);

    const tags = deriveMirrorPostTags(
      participants ?? [],
      mirrorPost.profile_id,
      (removedRows ?? []).map(r => r.tagged_profile_id)
    );

    const { error } = await admin
      .from('posts')
      .update({ tags })
      .eq('id', mirrorPost.id);
    if (error) {
      console.error(`syncMirrorPostTags(${groupPostId}) update failed:`, error.message);
    }
  } catch (err) {
    console.error(`syncMirrorPostTags(${groupPostId}) failed:`, err);
  }
}
