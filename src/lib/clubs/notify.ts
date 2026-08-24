// ── Club notifications ──────────────────────────────────────────────────────
// Same contract as leagues/notify.ts: direct inserts on the admin client,
// BEST-EFFORT (a failed notification never fails the action), lazily
// imported by routes. notifyClubRole is the first sender of the
// long-dormant 'club_update' type (allowed since 028's era, unsent until
// now — the front-loading rule paying off years later).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches guardian-notify's Admin alias; the notifier is schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export interface ClubJoinNotification {
  ownerProfileId: string | null;
  actorId: string;
  clubId: string;
  clubName: string;
}

/** Tell the owner someone joined their club. */
export async function notifyClubJoin(admin: Admin, n: ClubJoinNotification): Promise<void> {
  try {
    if (!n.ownerProfileId || n.ownerProfileId === n.actorId) return;
    const { data: actor } = await admin
      .from('profiles')
      .select('first_name, full_name, display_name')
      .eq('id', n.actorId)
      .maybeSingle();
    const actorName = actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: 'club_join',
      actor_id: n.actorId,
      title: `${actorName} joined ${n.clubName}`,
      message: null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId },
    });
    if (error) console.error('[CLUB NOTIFY] join notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] join notify failed:', e);
  }
}

export interface ClubRoleNotification {
  profileId: string;
  clubId: string;
  clubName: string;
  role: 'manager' | 'member';
}

/** Tell a member their role changed — 'club_update' gets its first sender. */
export async function notifyClubRole(admin: Admin, n: ClubRoleNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'club_update',
      actor_id: null,
      title: n.role === 'manager'
        ? `You're now a manager of ${n.clubName}`
        : `Your manager role in ${n.clubName} was removed`,
      message: null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId, role: n.role },
    });
    if (error) console.error('[CLUB NOTIFY] role notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] role notify failed:', e);
  }
}

export interface ClubRequestResultNotification {
  requesterProfileId: string;
  requestId: string;
  clubName: string;
  approved: boolean;
  clubId: string | null;
  reason: string | null;
}

/** Tell the requester their "Start a club" request was decided. */
export async function notifyClubRequestResult(
  admin: Admin,
  n: ClubRequestResultNotification
): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.requesterProfileId,
      type: 'club_request_result',
      actor_id: null,
      title: n.approved
        ? `Your club ${n.clubName} was approved`
        : `Your club request for ${n.clubName} was declined`,
      message: n.approved ? null : n.reason,
      action_url: n.approved && n.clubId ? `/club/${n.clubId}` : '/club/start',
      is_read: false,
      metadata: {
        request_id: n.requestId,
        decision: n.approved ? 'approved' : 'declined',
        ...(n.clubId ? { club_id: n.clubId } : {}),
      },
    });
    if (error) console.error('[CLUB NOTIFY] request result notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] request result notify failed:', e);
  }
}
