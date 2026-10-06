// ── The ONE writer of draft → published (Drafts round, mig 253, Oct 2026) ──
// Finish and Post are two actions. A recorded thing (a golf round's feed
// post) is born 'draft' and stays a draft — off the feed, off every profile
// grid, visible only to its owner, their guardian and the round's players —
// until the owner POSTS it from the review screen. This is the only function
// that turns a draft into a published post; the sweep, the score routes and
// the round's completion never do (nothing is ever auto-posted).
//
// A round's post may be posted only once the round is FINISHED
// (group_posts.status = 'completed'): the review screen sits after Finish.
// Posting stamps created_at = now() so the post lands at the top of the feed
// at the moment it was posted (the completion-time bump it replaces).
//
// Supervised athletes: the Aug 20 2026 carve-out STAYS by Tom's decision
// (Oct 6 2026) — a supervised athlete's Post publishes directly; the
// approval queue is for ordinary posts.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export type PublishRefusal = 'not_found' | 'not_a_draft' | 'round_not_finished' | 'write_failed';

export const PUBLISH_REFUSALS: Record<PublishRefusal, { status: 404 | 409 | 500; error: string }> = {
  not_found: { status: 404, error: 'Post not found' },
  not_a_draft: { status: 409, error: 'This is already posted.' },
  round_not_finished: { status: 409, error: 'Finish the round before you post it.' },
  write_failed: { status: 500, error: 'Could not post it. Try again.' },
};

export type PublishOutcome =
  | { ok: true; postId: string; status: 'published'; posted_at: string }
  | { ok: false; reason: PublishRefusal; status: 404 | 409 | 500; error: string };

const refuse = (reason: PublishRefusal): PublishOutcome => ({ ok: false, reason, ...PUBLISH_REFUSALS[reason] });

/**
 * Post a draft. The caller has already decided the session may manage this
 * post's content (the owner, or a write_content guardian). Guarded on
 * status = 'draft' so two taps post once; a round's post needs the round
 * completed.
 */
export async function publishDraftPost(admin: Admin, input: { postId: string }): Promise<PublishOutcome> {
  const { data: post, error } = await admin
    .from('posts')
    .select('id, profile_id, status, group_post_id')
    .eq('id', input.postId)
    .maybeSingle();
  if (error || !post) return refuse('not_found');
  if (post.status !== 'draft') return refuse('not_a_draft');

  if (post.group_post_id) {
    const { data: round } = await admin
      .from('group_posts')
      .select('status')
      .eq('id', post.group_post_id)
      .maybeSingle();
    if (round?.status !== 'completed') return refuse('round_not_finished');
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from('posts')
    .update({ status: 'published', created_at: now })
    .eq('id', post.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();
  if (updateError || !updated) return refuse(updateError ? 'write_failed' : 'not_a_draft');
  return { ok: true, postId: post.id, status: 'published', posted_at: now };
}
