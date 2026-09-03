// ── Org access (phase 9 V1, leagues in program 11) — visibility + join policy ─
// Tom: clubs are "private or public"; joining "needs an approval process";
// leagues get the same (Sep 3 2026). This is the ONE reader every gate uses
// (the org GET, the org-site modules, the standings twins, search, the join
// route), so a pre-176 / pre-177 database (42703) reads "public / open"
// and never darkens anything. The pure halves are node-tested.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export type OrgVisibility = 'public' | 'private';
export type OrgJoinPolicy = 'open' | 'approval';
/** @deprecated names kept for the phase-9 callers — the same types. */
export type ClubVisibility = OrgVisibility;
export type ClubJoinPolicy = OrgJoinPolicy;

export interface OrgAccess {
  /** False when the columns are unknown (pre-176/177) or the org is missing. */
  known: boolean;
  visibility: OrgVisibility;
  joinPolicy: OrgJoinPolicy;
}
export type ClubAccess = OrgAccess;

export const OPEN_ACCESS: OrgAccess = { known: false, visibility: 'public', joinPolicy: 'open' };

/** PURE: the access off an org row (absent columns ⇒ public / open). */
export function accessFromRow(row: Record<string, unknown> | null | undefined): OrgAccess {
  if (!row || !('visibility' in row)) return OPEN_ACCESS;
  return {
    known: true,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    joinPolicy: row.join_policy === 'approval' ? 'approval' : 'open',
  };
}

/** The live read for either side. Any error (42703 on a pre-176/177
 *  database included) → open. */
export async function readOrgAccess(admin: Admin, side: OrgSide, orgId: string): Promise<OrgAccess> {
  const { data, error } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select('id, visibility, join_policy')
    .eq('id', orgId)
    .maybeSingle();
  if (error || !data) return OPEN_ACCESS;
  return accessFromRow(data as unknown as Record<string, unknown>);
}

/** The phase-9 club reader — `readOrgAccess(admin, 'club', id)`. */
export function readClubAccess(admin: Admin, clubId: string): Promise<OrgAccess> {
  return readOrgAccess(admin, 'club', clubId);
}

/** PURE: may this viewer see the members-only content (standings, results,
 *  players, roster)? A public org shows everyone; a private one shows
 *  members (any role) only. */
export function canSeeMembersContent(input: { visibility: OrgVisibility; isMember: boolean }): boolean {
  return input.visibility === 'public' || input.isMember;
}

export function isPrivate(access: Pick<OrgAccess, 'visibility'>): boolean {
  return access.visibility === 'private';
}
