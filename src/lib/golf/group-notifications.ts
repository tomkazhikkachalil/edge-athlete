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
import { isActiveParticipant } from '@/lib/golf/round-status';

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

// ── Milestones only (Nov 19 2026) ─────────────────────────────────────────────
// Tom's group round sent him 20+ notifications: every hole saved inserted a
// "posted scores for your shared round" row for the round's creator, named
// after the card's OWNER (so entering a friend's scores notified him about
// himself), with no dedupe, and each row also went out as a push. His rule:
// milestones only. A round now says three things and nothing per hole:
//   • you are invited                      (notifyGroupInvites, unchanged)
//   • a golfer finished their card         (once per card; never to the person
//                                           who entered it)
//   • the round is final, with the board   (once per round, when it completes)

/** Does this save earn the creator a "finished their card" notice? Pure. */
export function cardMilestone(input: {
  /** Who is signed in and entered the score. */
  actorId: string;
  creatorId: string;
  /** Whose card it is. */
  cardOwnerId: string;
  holesCompleted: number | null | undefined;
  holesPlayed: number | null | undefined;
}): boolean {
  const { holesCompleted, holesPlayed } = input;
  if (typeof holesPlayed !== 'number' || holesPlayed <= 0) return false;
  if (typeof holesCompleted !== 'number' || holesCompleted < holesPlayed) return false; // not a full card yet
  if (input.actorId === input.creatorId) return false; // the creator entered it: nothing to tell them
  if (input.cardOwnerId === input.creatorId) return false; // the creator's own card
  return true;
}

async function alreadySent(supabase: Admin, marker: Record<string, string>): Promise<boolean> {
  const { data } = await supabase.from('notifications').select('id').eq('type', 'group_update').contains('metadata', marker).limit(1);
  return !!data && data.length > 0;
}

/**
 * A score was saved. At most two notices come of it, each once: the card's
 * owner finished their card (to the creator), and the round is final (to every
 * golfer but the one whose save finished it). A hole on its own says nothing.
 */
export async function notifyScoresPosted(
  ctx: GroupNotifyContext,
  input: { creatorId: string; cardOwnerId: string; actorId: string; holesCompleted: number | null | undefined }
): Promise<void> {
  try {
    const { data: card } = await ctx.supabase.from('golf_scorecard_data').select('holes_played').eq('group_post_id', ctx.groupPostId).maybeSingle();
    const holesPlayed = (card as { holes_played?: number | null } | null)?.holes_played ?? null;
    if (cardMilestone({ ...input, holesPlayed })) {
      const marker = { group_post_id: ctx.groupPostId, event: 'card_complete', card_owner: input.cardOwnerId };
      if (!(await alreadySent(ctx.supabase, marker))) {
        const name = await actorName(ctx.supabase, input.cardOwnerId);
        const { error } = await ctx.supabase.from('notifications').insert({
          user_id: input.creatorId,
          type: 'group_update',
          actor_id: input.cardOwnerId,
          title: `${name} finished their card`,
          message: ctx.title,
          action_url: ctx.actionUrl,
          is_read: false,
          metadata: marker,
        });
        if (error) console.error('[GROUP NOTIFY] card-complete failed:', error);
      }
    }
    await notifyRoundFinal(ctx, input.actorId);
  } catch (e) {
    console.error('[GROUP NOTIFY] scores-posted failed:', e);
  }
}

/**
 * The round is final: once per round, when its status is `completed` (by the
 * last card filling or by Finish round), to every golfer who has not declined
 * except the one whose action finished it. A solo round has no leaderboard
 * moment. (Until Nov 19 2026 this fired when every golfer had ANY total, which
 * is after their first hole.)
 */
export async function notifyRoundFinal(ctx: GroupNotifyContext, actorId: string): Promise<void> {
  try {
    const { data: round } = await ctx.supabase.from('group_posts').select('status').eq('id', ctx.groupPostId).maybeSingle();
    if ((round as { status?: string } | null)?.status !== 'completed') return;
    const { data: participants } = await ctx.supabase.from('group_post_participants').select('profile_id, status').eq('group_post_id', ctx.groupPostId);
    const golfers = (participants || []).filter(p => isActiveParticipant(p.status));
    if (golfers.length < 2) return;
    const marker = { group_post_id: ctx.groupPostId, event: 'leaderboard_final' };
    if (await alreadySent(ctx.supabase, marker)) return;
    const rows = golfers
      .filter(p => p.profile_id !== actorId)
      .map(p => ({
        user_id: p.profile_id,
        type: 'group_update',
        actor_id: actorId,
        title: 'Final leaderboard is in for your shared round',
        message: ctx.title,
        action_url: ctx.actionUrl,
        is_read: false,
        metadata: marker,
      }));
    if (rows.length > 0) {
      const { error } = await ctx.supabase.from('notifications').insert(rows);
      if (error) console.error('[GROUP NOTIFY] leaderboard-final failed:', error);
    }
  } catch (e) {
    console.error('[GROUP NOTIFY] round-final failed:', e);
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
