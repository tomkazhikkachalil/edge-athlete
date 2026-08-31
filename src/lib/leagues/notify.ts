// ── League notifications ─────────────────────────────────────────────────────
// Same contract as guardian-notify.ts and the shared-round notifiers: direct
// inserts on the admin client (create_notification's preference gate has no
// branch for these types), and BEST-EFFORT — a failed notification never
// fails the join that triggered it. Lazily imported by the members route.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches guardian-notify's Admin alias; the notifier is schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export interface LeagueJoinNotification {
  /** The league's owner (profiles.id === auth user id). Null = orphaned league. */
  ownerProfileId: string | null;
  /** The athlete who joined. */
  actorId: string;
  leagueId: string;
  leagueName: string;
}

/** Tell the owner someone joined their league. No-op when the league is
 *  orphaned or the owner joined their own league (can't happen via the API,
 *  but the guard is free). */
export async function notifyLeagueJoin(admin: Admin, n: LeagueJoinNotification): Promise<void> {
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
      type: 'league_join',
      actor_id: n.actorId,
      title: `${actorName} joined ${n.leagueName}`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId },
    });
    if (error) console.error('[LEAGUE NOTIFY] join notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] join notify failed:', e);
  }
}

export interface LeagueRoleNotification {
  /** The member whose role changed. */
  profileId: string;
  leagueId: string;
  leagueName: string;
  /** 'owner' arrives only from the owners core (0.8); the members route
   *  stays zod-narrowed to manager|member. */
  role: 'owner' | 'manager' | 'member';
}

/** Tell a member their role changed — the front-loaded 'league_update' type's
 *  first sender. Same never-throws contract as notifyLeagueJoin. */
export async function notifyLeagueRole(admin: Admin, n: LeagueRoleNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'league_update',
      actor_id: null,
      title: n.role === 'owner'
        ? `You're now an owner of ${n.leagueName}`
        : n.role === 'manager'
          ? `You're now a manager of ${n.leagueName}`
          : `Your manager role in ${n.leagueName} was removed`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId, role: n.role },
    });
    if (error) console.error('[LEAGUE NOTIFY] role notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] role notify failed:', e);
  }
}

export interface LeagueRequestResultNotification {
  requesterProfileId: string;
  requestId: string;
  leagueName: string;
  approved: boolean;
  /** Set on approval — the notification links straight to the new league. */
  leagueId: string | null;
  /** Set on decline. */
  reason: string | null;
}

/** Tell the requester their "Start a league" request was decided. actor_id
 *  stays null — admin decisions aren't social actors (consent_result
 *  precedent). A decline links back to /league/start (the re-request lives
 *  there; dead-end notifications are against house rules). */
export async function notifyLeagueRequestResult(
  admin: Admin,
  n: LeagueRequestResultNotification
): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.requesterProfileId,
      type: 'league_request_result',
      actor_id: null,
      title: n.approved
        ? `Your league ${n.leagueName} was approved`
        : `Your league request for ${n.leagueName} was declined`,
      message: n.approved ? null : n.reason,
      action_url: n.approved && n.leagueId ? `/league/${n.leagueId}` : '/league/start',
      is_read: false,
      metadata: {
        request_id: n.requestId,
        decision: n.approved ? 'approved' : 'declined',
        ...(n.leagueId ? { league_id: n.leagueId } : {}),
      },
    });
    if (error) console.error('[LEAGUE NOTIFY] request result notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] request result notify failed:', e);
  }
}

export interface RosterOfferNotification {
  /** The invited athlete. */
  profileId: string;
  leagueId: string;
  leagueName: string;
}

/** Tell an athlete the league invited them to its roster (0.3). Rides the
 *  'league_update' type on purpose — the dedicated roster type arrives with
 *  0.10's guardian queue; metadata.roster is the disambiguator. */
export async function notifyRosterOffer(admin: Admin, n: RosterOfferNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'league_update',
      actor_id: null,
      title: `${n.leagueName} invited you to its roster`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId, roster: 'offer' },
    });
    if (error) console.error('[LEAGUE NOTIFY] roster offer notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] roster offer notify failed:', e);
  }
}

export interface RosterResultNotification {
  /** The league's owner — the accept/decline audience (the offering
   *  manager's id isn't on the row; 0.10's dedicated type can do better). */
  ownerProfileId: string;
  /** The athlete who accepted/declined. */
  actorId: string;
  leagueId: string;
  leagueName: string;
  result: 'accepted' | 'declined';
}

/** Tell the owner an athlete answered a roster invitation. */
export async function notifyRosterResult(admin: Admin, n: RosterResultNotification): Promise<void> {
  try {
    const { data: actor } = await admin
      .from('profiles')
      .select('first_name, full_name, display_name')
      .eq('id', n.actorId)
      .maybeSingle();
    const actorName = actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: 'league_update',
      actor_id: n.actorId,
      title: `${actorName} ${n.result} the roster invitation to ${n.leagueName}`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId, roster: n.result },
    });
    if (error) console.error('[LEAGUE NOTIFY] roster result notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] roster result notify failed:', e);
  }
}

export interface RosterRemovedNotification {
  /** The removed athlete. */
  profileId: string;
  leagueId: string;
  leagueName: string;
}

/** Tell an athlete a manager removed them from the roster. Cancelled
 *  pending offers and self-leaves are deliberately quiet (the affiliation
 *  withdraw-quiet precedent). */
export async function notifyRosterRemoved(admin: Admin, n: RosterRemovedNotification): Promise<void> {
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: 'league_update',
      actor_id: null,
      title: `You were removed from the ${n.leagueName} roster`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId, roster: 'removed' },
    });
    if (error) console.error('[LEAGUE NOTIFY] roster removed notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] roster removed notify failed:', e);
  }
}
