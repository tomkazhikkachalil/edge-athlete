// ── Club notifications — the club names over `src/lib/orgs/notify.ts` ─────
// Since Round 5 step E one module notifies for both kinds (the kind decides
// the `type`, the metadata key and the URL family; the copy is one text).
// These adapters keep the club-named functions and fields their importers
// use until step F retires this file.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  notifyOrgJoin, notifyOrgRole, notifyOrgRequestResult, notifyOrgRosterOffer,
  notifyOrgRosterResult, notifyOrgRosterRemoved, notifyOrgJoinRequest, notifyOrgJoinDecision,
} from '@/lib/orgs/notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notifier's Admin alias
type Admin = SupabaseClient<any, 'public', any>;

export interface ClubJoinNotification { ownerProfileId: string | null; actorId: string; clubId: string; clubName: string; }
export function notifyClubJoin(admin: Admin, n: ClubJoinNotification): Promise<void> {
  return notifyOrgJoin(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, ownerProfileId: n.ownerProfileId, actorId: n.actorId });
}

export interface ClubRoleNotification { profileId: string; clubId: string; clubName: string; role: 'owner' | 'manager' | 'member'; }
export function notifyClubRole(admin: Admin, n: ClubRoleNotification): Promise<void> {
  return notifyOrgRole(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, profileId: n.profileId, role: n.role });
}

export interface ClubRequestResultNotification { requesterProfileId: string; requestId: string; clubName: string; approved: boolean; clubId: string | null; reason: string | null; }
export function notifyClubRequestResult(admin: Admin, n: ClubRequestResultNotification): Promise<void> {
  return notifyOrgRequestResult(admin, { kind: 'club', requesterProfileId: n.requesterProfileId, requestId: n.requestId, orgName: n.clubName, approved: n.approved, orgId: n.clubId, reason: n.reason });
}

export interface ClubRosterOfferNotification { profileId: string; clubId: string; clubName: string; }
export function notifyRosterOffer(admin: Admin, n: ClubRosterOfferNotification): Promise<void> {
  return notifyOrgRosterOffer(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, profileId: n.profileId });
}

export interface ClubRosterResultNotification { ownerProfileId: string; actorId: string; clubId: string; clubName: string; result: 'accepted' | 'declined'; }
export function notifyRosterResult(admin: Admin, n: ClubRosterResultNotification): Promise<void> {
  return notifyOrgRosterResult(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, ownerProfileId: n.ownerProfileId, actorId: n.actorId, result: n.result });
}

export interface ClubRosterRemovedNotification { profileId: string; clubId: string; clubName: string; }
export function notifyRosterRemoved(admin: Admin, n: ClubRosterRemovedNotification): Promise<void> {
  return notifyOrgRosterRemoved(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, profileId: n.profileId });
}

export interface ClubJoinRequestNotification { managerIds: string[]; actorId: string; clubId: string; clubName: string; requestId: string; }
export function notifyClubJoinRequest(admin: Admin, n: ClubJoinRequestNotification): Promise<void> {
  return notifyOrgJoinRequest(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, managerIds: n.managerIds, actorId: n.actorId, requestId: n.requestId });
}

export interface ClubJoinDecisionNotification { profileId: string; clubId: string; clubName: string; approved: boolean; requestId: string; }
export function notifyClubJoinDecision(admin: Admin, n: ClubJoinDecisionNotification): Promise<void> {
  return notifyOrgJoinDecision(admin, { kind: 'club', orgId: n.clubId, orgName: n.clubName, profileId: n.profileId, approved: n.approved, requestId: n.requestId });
}
