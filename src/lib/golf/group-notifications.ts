// ── Shared-round notification fan-out ─────────────────────────────────────────
// The invite → attest → scores → leaderboard loop only works socially if each
// step notifies the right people. All senders here are BEST-EFFORT: a failed
// notification never fails the round action itself.
//
// Types (migration 028): 'group_invite' and 'group_update' are inserted
// directly (create_notification's preference gate has no branch for them and
// would silently drop them — the messages route set this precedent with
// 'new_message'). Self-notification guards are handled here.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

async function actorName(supabase: Admin, profileId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return 'Someone';
  return (
    [data.first_name, data.last_name].filter(Boolean).join(' ') ||
    data.full_name ||
    'Someone'
  );
}

interface GroupNotifyContext {
  supabase: Admin;
  groupPostId: string;
  title: string;          // round title, e.g. "Golf at Eagle Creek"
  actionUrl: string | null; // deep link to the feed post when known
}

/** Invitations: notify every invited participant (never the creator). */
export async function notifyGroupInvites(
  ctx: GroupNotifyContext,
  creatorId: string,
  invitedProfileIds: string[]
): Promise<void> {
  try {
    const recipients = [...new Set(invitedProfileIds)].filter(id => id !== creatorId);
    if (recipients.length === 0) return;

    const name = await actorName(ctx.supabase, creatorId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'group_invite',
      actor_id: creatorId,
      title: `${name} added you to a shared round`,
      message: ctx.title,
      action_url: ctx.actionUrl,
      is_read: false,
      metadata: { group_post_id: ctx.groupPostId },
    }));
    const { error } = await ctx.supabase.from('notifications').insert(rows);
    if (error) console.error('[GROUP NOTIFY] invite fan-out failed:', error);
  } catch (e) {
    console.error('[GROUP NOTIFY] invite fan-out failed:', e);
  }
}

/** Attestation: tell the creator someone confirmed or declined. */
export async function notifyAttestation(
  ctx: GroupNotifyContext,
  creatorId: string,
  participantProfileId: string,
  status: 'confirmed' | 'declined' | 'maybe'
): Promise<void> {
  try {
    if (participantProfileId === creatorId) return;
    const name = await actorName(ctx.supabase, participantProfileId);
    const titleText =
      status === 'confirmed' ? `${name} is in for your shared round`
      : status === 'declined' ? `${name} declined your shared round`
      : `${name} might join your shared round`;

    const { error } = await ctx.supabase.from('notifications').insert({
      user_id: creatorId,
      type: 'group_update',
      actor_id: participantProfileId,
      title: titleText,
      message: ctx.title,
      action_url: ctx.actionUrl,
      is_read: false,
      metadata: { group_post_id: ctx.groupPostId, attest_status: status },
    });
    if (error) console.error('[GROUP NOTIFY] attestation failed:', error);
  } catch (e) {
    console.error('[GROUP NOTIFY] attestation failed:', e);
  }
}

/**
 * Scores posted: tell the creator (when someone else posted), and when EVERY
 * confirmed participant now has a score, tell all confirmed participants the
 * leaderboard is final.
 */
export async function notifyScoresPosted(
  ctx: GroupNotifyContext,
  creatorId: string,
  scorerProfileId: string
): Promise<void> {
  try {
    const name = await actorName(ctx.supabase, scorerProfileId);

    if (scorerProfileId !== creatorId) {
      const { error } = await ctx.supabase.from('notifications').insert({
        user_id: creatorId,
        type: 'group_update',
        actor_id: scorerProfileId,
        title: `${name} posted scores for your shared round`,
        message: ctx.title,
        action_url: ctx.actionUrl,
        is_read: false,
        metadata: { group_post_id: ctx.groupPostId, event: 'scores_posted' },
      });
      if (error) console.error('[GROUP NOTIFY] scores-posted failed:', error);
    }

    // Completion check: all confirmed participants have a total_score
    const { data: participants } = await ctx.supabase
      .from('group_post_participants')
      .select('profile_id, status, scores:golf_participant_scores (total_score)')
      .eq('group_post_id', ctx.groupPostId);

    const confirmed = (participants || []).filter(p => p.status === 'confirmed');
    if (confirmed.length < 2) return; // solo "groups" don't get a leaderboard moment

    const allScored = confirmed.every(p => {
      const scores = Array.isArray(p.scores) ? p.scores[0] : p.scores;
      return scores && scores.total_score !== null;
    });
    if (!allScored) return;

    // Notify every confirmed participant except the final scorer (they just
    // watched it complete). Deduped against a prior completion notification
    // via metadata marker — one leaderboard moment per round.
    const { data: existing } = await ctx.supabase
      .from('notifications')
      .select('id')
      .eq('type', 'group_update')
      .contains('metadata', { group_post_id: ctx.groupPostId, event: 'leaderboard_final' })
      .limit(1);
    if (existing && existing.length > 0) return;

    const rows = confirmed
      .filter(p => p.profile_id !== scorerProfileId)
      .map(p => ({
        user_id: p.profile_id,
        type: 'group_update',
        actor_id: scorerProfileId,
        title: 'Final leaderboard is in for your shared round',
        message: ctx.title,
        action_url: ctx.actionUrl,
        is_read: false,
        metadata: { group_post_id: ctx.groupPostId, event: 'leaderboard_final' },
      }));
    if (rows.length > 0) {
      const { error } = await ctx.supabase.from('notifications').insert(rows);
      if (error) console.error('[GROUP NOTIFY] leaderboard-final failed:', error);
    }
  } catch (e) {
    console.error('[GROUP NOTIFY] scores-posted failed:', e);
  }
}

/** Resolve the feed post deep link for a group post (may be null). */
export async function groupPostActionUrl(
  supabase: Admin,
  groupPostId: string,
  creatorId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('posts')
    .select('id')
    .eq('group_post_id', groupPostId)
    .maybeSingle();
  return data ? `/athlete/${creatorId}?post=${data.id}` : null;
}
