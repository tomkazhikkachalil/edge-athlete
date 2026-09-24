// ── Org notifications — ONE module for both kinds (Round 5 step E) ───────────
// Same contract as guardian-notify.ts and the shared-round notifiers: direct
// inserts on the admin client (create_notification's preference gate has no
// branch for these types), and BEST-EFFORT — a failed notification never
// fails the action that triggered it. Lazily imported by the routes.
//
// What the kind decides, and only this: the notification `type`
// (`league_join` / `club_join`, `league_update` / `club_update`,
// `league_request_result` / `club_request_result` — the vocabulary
// notifications_type_check admits since 113 / 117), the `metadata` key
// (the kind's PAIR_COLUMN — history, and the announce readers match on it:
// that constant's one remaining use), and the URL family. The copy is one
// text. `src/lib/leagues/notify.ts` and `src/lib/clubs/notify.ts` adapt
// their old field names onto these until step F retires them.

import type { SupabaseClient } from '@supabase/supabase-js';
import { joinDecisionMessage, joinDecisionTitle, joinRequestTitle } from './join-requests';
import { type OrgKind, PAIR_COLUMN } from './org-ref';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches guardian-notify's Admin alias; the notifier is schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG: Record<OrgKind, string> = { league: '[LEAGUE NOTIFY]', club: '[CLUB NOTIFY]' };

/** The kind's notification vocabulary and URL family. */
export function orgNotifyTypes(kind: OrgKind) {
  return {
    join: `${kind}_join` as const,
    update: `${kind}_update` as const,
    requestResult: `${kind}_request_result` as const,
    /** The metadata key the announce readers match on — history, forever. */
    metadataKey: PAIR_COLUMN[kind],
    page: (id: string) => `/${kind}/${id}`,
    console: (id: string) => `/app/org/${kind}/${id}`,
    start: `/${kind}/start`,
  };
}

async function actorFirstName(admin: Admin, actorId: string): Promise<string> {
  const { data: actor } = await admin
    .from('profiles')
    .select('first_name, full_name, display_name')
    .eq('id', actorId)
    .maybeSingle();
  return actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
}

interface OrgRef {
  kind: OrgKind;
  orgId: string;
  orgName: string;
}

export interface OrgJoinNotification extends OrgRef {
  /** The org's owner (profiles.id === auth user id). Null = orphaned org. */
  ownerProfileId: string | null;
  /** The athlete who joined. */
  actorId: string;
}

/** Tell the owner someone joined their org. No-op when the org is orphaned
 *  or the owner joined their own org (can't happen via the API, but the
 *  guard is free). */
export async function notifyOrgJoin(admin: Admin, n: OrgJoinNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    if (!n.ownerProfileId || n.ownerProfileId === n.actorId) return;
    const actorName = await actorFirstName(admin, n.actorId);
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: t.join,
      actor_id: n.actorId,
      title: `${actorName} joined ${n.orgName}`,
      message: null,
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId },
    });
    if (error) console.error(`${TAG[n.kind]} join notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} join notify failed:`, e);
  }
}

export interface OrgRoleNotification extends OrgRef {
  /** The member whose role changed. */
  profileId: string;
  /** 'owner' arrives only from the owners core (0.8); the members route
   *  stays zod-narrowed to manager|member. */
  role: 'owner' | 'manager' | 'member';
}

/** Tell a member their role changed — the front-loaded '<kind>_update'
 *  type's first sender. Same never-throws contract as notifyOrgJoin. */
export async function notifyOrgRole(admin: Admin, n: OrgRoleNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: t.update,
      actor_id: null,
      title: n.role === 'owner'
        ? `You're now an owner of ${n.orgName}`
        : n.role === 'manager'
          ? `You're now a manager of ${n.orgName}`
          : `Your manager role in ${n.orgName} was removed`,
      message: null,
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId, role: n.role },
    });
    if (error) console.error(`${TAG[n.kind]} role notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} role notify failed:`, e);
  }
}

export interface OrgRequestResultNotification {
  kind: OrgKind;
  requesterProfileId: string;
  requestId: string;
  orgName: string;
  approved: boolean;
  /** Set on approval — the notification links straight to the new org. */
  orgId: string | null;
  /** Set on decline. */
  reason: string | null;
}

/** Tell the requester their "Start a league / club" request was decided.
 *  actor_id stays null — admin decisions aren't social actors
 *  (consent_result precedent). A decline links back to the start page (the
 *  re-request lives there; dead-end notifications are against house rules). */
export async function notifyOrgRequestResult(admin: Admin, n: OrgRequestResultNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.requesterProfileId,
      type: t.requestResult,
      actor_id: null,
      title: n.approved
        ? `Your ${n.kind} ${n.orgName} was approved`
        : `Your ${n.kind} request for ${n.orgName} was declined`,
      message: n.approved ? null : n.reason,
      action_url: n.approved && n.orgId ? t.page(n.orgId) : t.start,
      is_read: false,
      metadata: {
        request_id: n.requestId,
        decision: n.approved ? 'approved' : 'declined',
        ...(n.orgId ? { [t.metadataKey]: n.orgId } : {}),
      },
    });
    if (error) console.error(`${TAG[n.kind]} request result notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} request result notify failed:`, e);
  }
}

export interface OrgRosterOfferNotification extends OrgRef {
  /** The invited athlete. */
  profileId: string;
}

/** Tell an athlete the org invited them to its roster (0.3). Rides the
 *  '<kind>_update' type on purpose — the dedicated roster type arrives with
 *  0.10's guardian queue; metadata.roster is the disambiguator. */
export async function notifyOrgRosterOffer(admin: Admin, n: OrgRosterOfferNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: t.update,
      actor_id: null,
      title: `${n.orgName} invited you to its roster`,
      message: null,
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId, roster: 'offer' },
    });
    if (error) console.error(`${TAG[n.kind]} roster offer notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} roster offer notify failed:`, e);
  }
}

export interface OrgRosterResultNotification extends OrgRef {
  /** The org's owner — the accept/decline audience (the offering manager's
   *  id isn't on the row; 0.10's dedicated type can do better). */
  ownerProfileId: string;
  /** The athlete who accepted/declined. */
  actorId: string;
  result: 'accepted' | 'declined';
}

/** Tell the owner an athlete answered a roster invitation. */
export async function notifyOrgRosterResult(admin: Admin, n: OrgRosterResultNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const actorName = await actorFirstName(admin, n.actorId);
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: t.update,
      actor_id: n.actorId,
      title: `${actorName} ${n.result} the roster invitation to ${n.orgName}`,
      message: null,
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId, roster: n.result },
    });
    if (error) console.error(`${TAG[n.kind]} roster result notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} roster result notify failed:`, e);
  }
}

export interface OrgRosterRemovedNotification extends OrgRef {
  /** The removed athlete. */
  profileId: string;
}

/** Tell an athlete a manager removed them from the roster. Cancelled
 *  pending offers and self-leaves are deliberately quiet (the affiliation
 *  withdraw-quiet precedent). */
export async function notifyOrgRosterRemoved(admin: Admin, n: OrgRosterRemovedNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: t.update,
      actor_id: null,
      title: `You were removed from the ${n.orgName} roster`,
      message: null,
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId, roster: 'removed' },
    });
    if (error) console.error(`${TAG[n.kind]} roster removed notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} roster removed notify failed:`, e);
  }
}

// ── Program 11: join requests ───────────────────────────────────────────────

export interface OrgJoinRequestNotification extends OrgRef {
  /** Owners + managers (the actor excluded, duplicates collapsed). */
  managerIds: string[];
  actorId: string;
  requestId: string;
}

/** Tell the managers someone asked to join (the approval policy). */
export async function notifyOrgJoinRequest(admin: Admin, n: OrgJoinRequestNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const targets = [...new Set(n.managerIds)].filter(id => id && id !== n.actorId);
    if (targets.length === 0) return;
    const actorName = await actorFirstName(admin, n.actorId);
    const { error } = await admin.from('notifications').insert(
      targets.map(userId => ({
        user_id: userId,
        type: t.join,
        actor_id: n.actorId,
        title: joinRequestTitle(actorName, n.orgName),
        message: 'Approve or decline from your console.',
        action_url: `${t.console(n.orgId)}#roster`,
        is_read: false,
        metadata: { [t.metadataKey]: n.orgId, request_id: n.requestId, join_request: true },
      }))
    );
    if (error) console.error(`${TAG[n.kind]} join request notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} join request notify failed:`, e);
  }
}

export interface OrgJoinDecisionNotification extends OrgRef {
  profileId: string;
  approved: boolean;
  requestId: string;
}

/** Tell the requester the decision ('<kind>_update' — an org telling a person). */
export async function notifyOrgJoinDecision(admin: Admin, n: OrgJoinDecisionNotification): Promise<void> {
  const t = orgNotifyTypes(n.kind);
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: n.profileId,
      type: t.update,
      actor_id: null,
      title: joinDecisionTitle(n.orgName, n.approved),
      message: joinDecisionMessage(n.kind, n.approved),
      action_url: t.page(n.orgId),
      is_read: false,
      metadata: { [t.metadataKey]: n.orgId, request_id: n.requestId, join_decision: n.approved ? 'approved' : 'declined' },
    });
    if (error) console.error(`${TAG[n.kind]} join decision notify failed:`, error);
  } catch (e) {
    console.error(`${TAG[n.kind]} join decision notify failed:`, e);
  }
}
