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
  /** 'owner' arrives only from the owners core (0.8). */
  role: 'owner' | 'manager' | 'member';
}

/** Tell a member their role changed — 'club_update' gets its first sender. */
export async function notifyClubRole(admin: Admin, n: ClubRoleNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'club_update',
      actor_id: null,
      title: n.role === 'owner'
        ? `You're now an owner of ${n.clubName}`
        : n.role === 'manager'
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

export interface ClubRosterOfferNotification {
  /** The invited athlete. */
  profileId: string;
  clubId: string;
  clubName: string;
}

/** Mirror of leagues/notify.notifyRosterOffer — 'club_update' type,
 *  metadata.roster disambiguates (dedicated type arrives with 0.10). */
export async function notifyRosterOffer(admin: Admin, n: ClubRosterOfferNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'club_update',
      actor_id: null,
      title: `${n.clubName} invited you to its roster`,
      message: null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId, roster: 'offer' },
    });
    if (error) console.error('[CLUB NOTIFY] roster offer notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] roster offer notify failed:', e);
  }
}

export interface ClubRosterResultNotification {
  ownerProfileId: string;
  actorId: string;
  clubId: string;
  clubName: string;
  result: 'accepted' | 'declined';
}

/** Tell the owner an athlete answered a roster invitation. */
export async function notifyRosterResult(admin: Admin, n: ClubRosterResultNotification): Promise<void> {
  try {
    const { data: actor } = await admin
      .from('profiles')
      .select('first_name, full_name, display_name')
      .eq('id', n.actorId)
      .maybeSingle();
    const actorName = actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: 'club_update',
      actor_id: n.actorId,
      title: `${actorName} ${n.result} the roster invitation to ${n.clubName}`,
      message: null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId, roster: n.result },
    });
    if (error) console.error('[CLUB NOTIFY] roster result notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] roster result notify failed:', e);
  }
}

export interface ClubRosterRemovedNotification {
  profileId: string;
  clubId: string;
  clubName: string;
}

/** Tell an athlete a manager removed them from the roster (cancels and
 *  self-leaves stay quiet). */
export async function notifyRosterRemoved(admin: Admin, n: ClubRosterRemovedNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'club_update',
      actor_id: null,
      title: `You were removed from the ${n.clubName} roster`,
      message: null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId, roster: 'removed' },
    });
    if (error) console.error('[CLUB NOTIFY] roster removed notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] roster removed notify failed:', e);
  }
}

// ── Phase 9 V2: join requests ───────────────────────────────────────────────

export function joinRequestTitle(actorName: string, clubName: string): string {
  return `${actorName} asked to join ${clubName}`;
}

export function joinDecisionTitle(clubName: string, approved: boolean): string {
  return approved ? `You're now a member of ${clubName}` : `Your request to join ${clubName} was declined`;
}

export interface ClubJoinRequestNotification {
  /** Owners + managers (the actor excluded, duplicates collapsed). */
  managerIds: string[];
  actorId: string;
  clubId: string;
  clubName: string;
  requestId: string;
}

/** Tell the managers someone asked to join (the approval policy). */
export async function notifyClubJoinRequest(admin: Admin, n: ClubJoinRequestNotification): Promise<void> {
  try {
    const targets = [...new Set(n.managerIds)].filter(id => id && id !== n.actorId);
    if (targets.length === 0) return;
    const { data: actor } = await admin
      .from('profiles')
      .select('first_name, full_name, display_name')
      .eq('id', n.actorId)
      .maybeSingle();
    const actorName = actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
    const { error } = await admin.from('notifications').insert(
      targets.map(userId => ({
        user_id: userId,
        type: 'club_join',
        actor_id: n.actorId,
        title: joinRequestTitle(actorName, n.clubName),
        message: 'Approve or decline from your console.',
        action_url: `/app/org/club/${n.clubId}#roster`,
        is_read: false,
        metadata: { club_id: n.clubId, request_id: n.requestId, join_request: true },
      }))
    );
    if (error) console.error('[CLUB NOTIFY] join request notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] join request notify failed:', e);
  }
}

export interface ClubJoinDecisionNotification {
  profileId: string;
  clubId: string;
  clubName: string;
  approved: boolean;
  requestId: string;
}

/** Tell the requester the decision (club_update — a club telling a person). */
export async function notifyClubJoinDecision(admin: Admin, n: ClubJoinDecisionNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'club_update',
      actor_id: null,
      title: joinDecisionTitle(n.clubName, n.approved),
      message: n.approved ? 'Welcome — the club page and its leagues are open to you.' : null,
      action_url: `/club/${n.clubId}`,
      is_read: false,
      metadata: { club_id: n.clubId, request_id: n.requestId, join_decision: n.approved ? 'approved' : 'declined' },
    });
    if (error) console.error('[CLUB NOTIFY] join decision notify failed:', error);
  } catch (e) {
    console.error('[CLUB NOTIFY] join decision notify failed:', e);
  }
}
