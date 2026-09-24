// ── League notifications — the league names over `src/lib/orgs/notify.ts` ─────
// Since Round 5 step E one module notifies for both kinds (the kind decides
// the `type`, the metadata key and the URL family; the copy is one text).
// These adapters keep the league-named functions and fields their importers
// use until step F retires this file.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  notifyOrgJoin, notifyOrgRole, notifyOrgRequestResult, notifyOrgRosterOffer,
  notifyOrgRosterResult, notifyOrgRosterRemoved, notifyOrgJoinRequest, notifyOrgJoinDecision,
} from '@/lib/orgs/notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notifier's Admin alias
type Admin = SupabaseClient<any, 'public', any>;

export interface LeagueJoinNotification { ownerProfileId: string | null; actorId: string; leagueId: string; leagueName: string; }
export function notifyLeagueJoin(admin: Admin, n: LeagueJoinNotification): Promise<void> {
  return notifyOrgJoin(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, ownerProfileId: n.ownerProfileId, actorId: n.actorId });
}

export interface LeagueRoleNotification { profileId: string; leagueId: string; leagueName: string; role: 'owner' | 'manager' | 'member'; }
export function notifyLeagueRole(admin: Admin, n: LeagueRoleNotification): Promise<void> {
  return notifyOrgRole(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, profileId: n.profileId, role: n.role });
}

export interface LeagueRequestResultNotification { requesterProfileId: string; requestId: string; leagueName: string; approved: boolean; leagueId: string | null; reason: string | null; }
export function notifyLeagueRequestResult(admin: Admin, n: LeagueRequestResultNotification): Promise<void> {
  return notifyOrgRequestResult(admin, { kind: 'league', requesterProfileId: n.requesterProfileId, requestId: n.requestId, orgName: n.leagueName, approved: n.approved, orgId: n.leagueId, reason: n.reason });
}

export interface RosterOfferNotification { profileId: string; leagueId: string; leagueName: string; }
export function notifyRosterOffer(admin: Admin, n: RosterOfferNotification): Promise<void> {
  return notifyOrgRosterOffer(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, profileId: n.profileId });
}

export interface RosterResultNotification { ownerProfileId: string; actorId: string; leagueId: string; leagueName: string; result: 'accepted' | 'declined'; }
export function notifyRosterResult(admin: Admin, n: RosterResultNotification): Promise<void> {
  return notifyOrgRosterResult(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, ownerProfileId: n.ownerProfileId, actorId: n.actorId, result: n.result });
}

export interface RosterRemovedNotification { profileId: string; leagueId: string; leagueName: string; }
export function notifyRosterRemoved(admin: Admin, n: RosterRemovedNotification): Promise<void> {
  return notifyOrgRosterRemoved(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, profileId: n.profileId });
}

export interface LeagueJoinRequestNotification { managerIds: string[]; actorId: string; leagueId: string; leagueName: string; requestId: string; }
export function notifyLeagueJoinRequest(admin: Admin, n: LeagueJoinRequestNotification): Promise<void> {
  return notifyOrgJoinRequest(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, managerIds: n.managerIds, actorId: n.actorId, requestId: n.requestId });
}

export interface LeagueJoinDecisionNotification { profileId: string; leagueId: string; leagueName: string; approved: boolean; requestId: string; }
export function notifyLeagueJoinDecision(admin: Admin, n: LeagueJoinDecisionNotification): Promise<void> {
  return notifyOrgJoinDecision(admin, { kind: 'league', orgId: n.leagueId, orgName: n.leagueName, profileId: n.profileId, approved: n.approved, requestId: n.requestId });
}
