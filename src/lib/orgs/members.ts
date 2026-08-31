// ── Org membership data-access layer (0.2) ──────────────────────────────────
// The ONE place org membership rows are written (and, after the read-switch,
// read). Routes keep their own authorization (orgs/authz.ts) and their own
// response bodies; this module owns the queries.
//
// `memberships` (migration 140) is the ONLY store. The legacy mirrored
// member tables were dropped by 148 (phase-0 cleanup, divergence pass zero).
//
// UPDATE/DELETE writes filter kind='follow' AND scope_type='org' explicitly:
// every open-join-era row is a follow/org row, and the filter makes 0.3's
// future roster rows structurally unreachable from these legacy-shaped
// paths (a roster edge gets its own gated creation flow in 0.3/0.10).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { maxOrgRole, type OrgRole, type OrgSide } from './authz';
import { isMissingTableError } from '@/lib/leagues/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface OrgRef {
  side: OrgSide;
  orgId: string;
}

type WriteResult = { error: PostgrestError | null };

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

async function insertMembership(
  admin: Admin,
  ref: OrgRef,
  profileId: string,
  role?: 'owner'
): Promise<WriteResult> {
  const row: Record<string, unknown> = { [orgColumn(ref.side)]: ref.orgId, profile_id: profileId };
  if (role) row.role = role;
  const { error } = await admin.from('memberships').insert(row);
  return { error };
}

/** POST join branch: the session user joins as a plain member (role default). */
export function joinOrg(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return insertMembership(admin, ref, profileId);
}

/** Org creation: the CREATOR's primary owner row. Later co-owners are
 *  minted by promoteFollowToOwner via the owners core (0.8). */
export function insertOwnerRow(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return insertMembership(admin, ref, profileId, 'owner');
}

// ── Owner-set writes (0.8) — called ONLY by orgs/owners.ts ──────────────────

/** Promote an existing member/manager follow row to owner. updated=false →
 *  no eligible row (not a member, or already owner). */
export async function promoteFollowToOwner(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{ updated: boolean; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .update({ role: 'owner' })
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org')
    .in('role', ['member', 'manager'])
    .select('id');
  return { updated: (data ?? []).length > 0, error };
}

/** Step-down landing: the owner's follow row becomes manager. The guarded
 *  role='owner' filter makes concurrent step-downs collide safely
 *  (updated=false → the row was no longer an owner row). Roster rows are
 *  untouched by the kind filter. */
export async function demoteOwnerToManager(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{ updated: boolean; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .update({ role: 'manager' })
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org')
    .eq('role', 'owner')
    .select('id');
  return { updated: (data ?? []).length > 0, error };
}

/** The org's owner rows, primary-first (joined_at ASC, id ASC — the id
 *  tie-break matters: batch seeds share a joined_at). */
export async function ownerRows(
  admin: Admin,
  ref: OrgRef
): Promise<{
  rows: Array<{ id: string; profile_id: string; joined_at: string }>;
  error: PostgrestError | null;
}> {
  const { data, error } = await admin
    .from('memberships')
    .select('id, profile_id, joined_at')
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org')
    .eq('role', 'owner')
    .order('joined_at', { ascending: true })
    .order('id', { ascending: true });
  return {
    rows: (data ?? []) as Array<{ id: string; profile_id: string; joined_at: string }>,
    error,
  };
}

async function deleteMembership(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  // Leaving (or being removed) ends roster participation too — the
  // roster ⊆ follow invariant's exit half. scope_type stays pinned.
  const { error } = await admin
    .from('memberships')
    .delete()
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .in('kind', ['follow', 'roster'])
    .eq('scope_type', 'org');
  return { error };
}

/** POST leave branch: the session user leaves. */
export function leaveOrg(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return deleteMembership(admin, ref, profileId);
}

/** DELETE route: owner/manager removes a plain member. */
export function removeMember(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return deleteMembership(admin, ref, profileId);
}

// ── Roster edges (0.3) — explicit kind, NEVER touch follow rows ─────────────

export type RosterStatus = 'pending' | 'active';

/** Manager mints the offer. Explicit kind+status — never the defaults. */
export async function insertRosterOffer(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<WriteResult> {
  const { error } = await admin.from('memberships').insert({
    [orgColumn(ref.side)]: ref.orgId,
    profile_id: profileId,
    kind: 'roster',
    status: 'pending',
  });
  return { error };
}

/** Athlete accepts their own pending offer. accepted=false → no pending
 *  row existed (already accepted, cancelled, or never offered). */
export async function acceptRosterOffer(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{ accepted: boolean; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .update({ status: 'active' })
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'roster')
    .eq('status', 'pending')
    .eq('scope_type', 'org')
    .select('id');
  return { accepted: (data ?? []).length > 0, error };
}

/** Decline / cancel / remove — DELETE the roster row (the 118
 *  decline-erases precedent; re-inviting stays possible). */
export async function deleteRosterRow(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{ deleted: boolean; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .delete()
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'roster')
    .eq('scope_type', 'org')
    .select('id');
  return { deleted: (data ?? []).length > 0, error };
}

/** One read powering the roster routes' decision tree: the target's follow
 *  role (the roster ⊆ follow gate) and roster status. */
export async function membershipEdges(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{
  followRole: OrgRole | null;
  rosterStatus: RosterStatus | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await admin
    .from('memberships')
    .select('role, kind, status')
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('scope_type', 'org');
  const rows = (data ?? []) as Array<{ role: string; kind: string; status: string }>;
  const rosterRow = rows.find(r => r.kind === 'roster');
  return {
    followRole: maxOrgRole(rows.filter(r => r.kind === 'follow').map(r => r.role)),
    rosterStatus: rosterRow ? ((rosterRow.status as RosterStatus) ?? null) : null,
    error,
  };
}

/** Pending offers are private to managers and the invitee; active roster
 *  membership is public. Pure — exported for the routes and unit tests. */
export function redactPendingRoster(
  members: MemberPreviewRow[],
  canManage: boolean,
  viewerId: string | null
): MemberPreviewRow[] {
  if (canManage) return members;
  return members.map(m =>
    m.roster === 'pending' && m.profile_id !== viewerId ? { ...m, roster: null } : m
  );
}

// ── Reads (the enumeration layer promised by orgs/authz.ts) ─────────────────
// Multi-row aware (0.3): a profile may hold BOTH a follow row and a roster
// row per org, so role reads reduce with maxOrgRole and enumeration reads
// dedupe. Enumeration keeps NO kind predicate except `rosterOrgIds` — the
// 0.10 calendar-merge placement variant, used by org-merge-server behind
// FEATURE_CALENDAR_ROSTER_ONLY and nowhere else. The member-list/count
// queries filter kind='follow' (roster ⊆ follow: one row per person).
// ORG-SCOPED BY CHARTER (0.5): every read here pins scope_type='org' —
// division/team-scoped rows (145+) are a different authority surface and
// get their own readers with 0.9/roles, never these.
// Functions own the query; callers keep their own error mapping unless
// every caller shares one policy (noted per function).

/** A profile's role in the org: MAX across their rows (kind is orthogonal
 *  to role). Callers treat role===null as "not a member"; the error is
 *  surfaced for the join-toggle's 500 branch. */
export async function getMemberRole(
  admin: Admin,
  ref: OrgRef,
  profileId: string
): Promise<{ role: OrgRole | null; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .select('role')
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('scope_type', 'org');
  return { role: maxOrgRole((data ?? []).map(r => r.role as string)), error };
}

/** Every org the profile belongs to, one query. Shared policy of both
 *  callers (calendar merge, org peers): missing table degrades to empty,
 *  anything else throws. */
export async function memberOrgIds(
  admin: Admin,
  profileId: string
): Promise<{ leagueIds: string[]; clubIds: string[] }> {
  const { data, error } = await admin
    .from('memberships')
    .select('league_id, club_id')
    .eq('profile_id', profileId)
    .eq('scope_type', 'org');
  if (error) {
    if (isMissingTableError(error.code)) return { leagueIds: [], clubIds: [] };
    throw error;
  }
  const rows = (data ?? []) as Array<{ league_id: string | null; club_id: string | null }>;
  return {
    leagueIds: [...new Set(rows.map(r => r.league_id).filter((id): id is string => !!id))],
    clubIds: [...new Set(rows.map(r => r.club_id).filter((id): id is string => !!id))],
  };
}

/** The 0.10 roster-only variant — the CALENDAR MERGE's placement read and
 *  nothing else (org-peers keeps the kind-blind memberOrgIds: the lens is
 *  a scope, not a grant). ACTIVE roster rows only: a pending offer must
 *  never place events. Same degrade policy as memberOrgIds. */
export async function rosterOrgIds(
  admin: Admin,
  profileId: string
): Promise<{ leagueIds: string[]; clubIds: string[] }> {
  const { data, error } = await admin
    .from('memberships')
    .select('league_id, club_id')
    .eq('profile_id', profileId)
    .eq('scope_type', 'org')
    .eq('kind', 'roster')
    .eq('status', 'active');
  if (error) {
    if (isMissingTableError(error.code)) return { leagueIds: [], clubIds: [] };
    throw error;
  }
  const rows = (data ?? []) as Array<{ league_id: string | null; club_id: string | null }>;
  return {
    leagueIds: [...new Set(rows.map(r => r.league_id).filter((id): id is string => !!id))],
    clubIds: [...new Set(rows.map(r => r.club_id).filter((id): id is string => !!id))],
  };
}

/** Member profile ids across a set of orgs on one side (peer fan-out).
 *  Same policy as memberOrgIds (single caller: org peers). */
export async function memberProfileIdsForOrgs(
  admin: Admin,
  side: OrgSide,
  orgIds: string[]
): Promise<string[]> {
  if (orgIds.length === 0) return [];
  const { data, error } = await admin
    .from('memberships')
    .select('profile_id')
    .in(orgColumn(side), orgIds)
    .eq('scope_type', 'org');
  if (error) {
    if (isMissingTableError(error.code)) return [];
    throw error;
  }
  return [...new Set((data ?? []).map(r => r.profile_id as string))];
}

/** Every member of one org (unbounded — callers accept that today). Raw
 *  {data, error}: the two callers map errors differently (notify logs and
 *  bails; activity 500s except missing-table). */
export async function memberProfileIds(
  admin: Admin,
  ref: OrgRef
): Promise<{ profileIds: string[]; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('scope_type', 'org');
  return { profileIds: [...new Set((data ?? []).map(r => r.profile_id as string))], error };
}

/** Does ANY of these profiles hold a member row in the org? Errors read as
 *  false — matching the household-access caller, which ignores them. */
export async function anyMembershipExists(
  admin: Admin,
  ref: OrgRef,
  profileIds: string[]
): Promise<boolean> {
  if (profileIds.length === 0) return false;
  const { data } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('scope_type', 'org')
    .in('profile_id', profileIds)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** A profile's memberships on one side, as {orgId, role} rows. Raw
 *  {rows, error}: the caller (getProfileOrganizations) logs and continues. */
export async function profileMembershipRows(
  admin: Admin,
  side: OrgSide,
  profileId: string
): Promise<{ rows: Array<{ orgId: string; role: string }>; error: PostgrestError | null }> {
  const col = orgColumn(side);
  const { data, error } = await admin
    .from('memberships')
    .select(`${col}, role`)
    .eq('profile_id', profileId)
    .eq('scope_type', 'org');
  // One entry per org: a dual-edge profile reduces to their max role.
  const byOrg = new Map<string, string[]>();
  for (const r of (data ?? []) as unknown as Array<Record<string, string>>) {
    if (!byOrg.has(r[col])) byOrg.set(r[col], []);
    byOrg.get(r[col])!.push(r.role);
  }
  const rows = [...byOrg.entries()].map(([orgId, roles]) => ({
    orgId,
    role: (maxOrgRole(roles) ?? 'member') as string,
  }));
  return { rows, error };
}

export interface MemberPreviewRow {
  profile_id: string;
  role: string;
  joined_at: string;
  profile: unknown;
  /** 0.3: the member's roster edge, merged onto their follow row. */
  roster: 'pending' | 'active' | null;
}

/** The org page's member panel: exact count and first `limit` rows over the
 *  kind='follow' edges (roster ⊆ follow: exactly one follow row per person,
 *  so count and limit mean people), plus the viewer's own role reduced with
 *  maxOrgRole across all their rows. Errors read as empty/null — matching
 *  the caller, which uses `data ?? []` with no error branches. */
export async function orgMemberPreview(
  admin: Admin,
  ref: OrgRef,
  viewerId: string | null,
  limit: number
): Promise<{
  count: number;
  members: MemberPreviewRow[];
  viewerRole: string | null;
  viewerRoster: 'pending' | 'active' | null;
}> {
  const col = orgColumn(ref.side);
  const [countRes, membersRes, rosterRes, viewerRes] = await Promise.all([
    admin
      .from('memberships')
      .select('profile_id', { count: 'exact', head: true })
      .eq(col, ref.orgId)
      .eq('kind', 'follow')
      .eq('scope_type', 'org'),
    admin
      .from('memberships')
      .select('profile_id, role, joined_at, profile:profile_id (id, handle, first_name, last_name, full_name, avatar_url)')
      .eq(col, ref.orgId)
      .eq('kind', 'follow')
      .eq('scope_type', 'org')
      .order('joined_at', { ascending: true })
      .limit(limit),
    admin
      .from('memberships')
      .select('profile_id, status')
      .eq(col, ref.orgId)
      .eq('kind', 'roster')
      .eq('scope_type', 'org'),
    viewerId
      ? admin
          .from('memberships')
          .select('role, kind, status')
          .eq(col, ref.orgId)
          .eq('profile_id', viewerId)
          .eq('scope_type', 'org')
      : Promise.resolve({ data: null }),
  ]);
  const rosterByProfile = new Map(
    ((rosterRes.data ?? []) as Array<{ profile_id: string; status: string }>).map(r => [
      r.profile_id,
      r.status as 'pending' | 'active',
    ])
  );
  const members = ((membersRes.data ?? []) as unknown as MemberPreviewRow[]).map(m => ({
    ...m,
    roster: rosterByProfile.get(m.profile_id) ?? null,
  }));
  const viewerRows = (viewerRes.data ?? []) as Array<{ role: string; kind: string; status: string }>;
  const viewerRosterRow = viewerRows.find(r => r.kind === 'roster');
  return {
    count: countRes.count ?? 0,
    members,
    viewerRole: maxOrgRole(viewerRows.map(r => r.role)),
    viewerRoster: viewerRosterRow ? ((viewerRosterRow.status as 'pending' | 'active') ?? null) : null,
  };
}

/** Member counts per org (admin dashboards). Keeps today's fetch-all +
 *  JS-count shape; errors read as empty — matching both admin callers. */
export async function memberCountsByOrg(
  admin: Admin,
  side: OrgSide,
  orgIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (orgIds.length === 0) return counts;
  const col = orgColumn(side);
  const { data } = await admin
    .from('memberships')
    .select(`${col}, profile_id`)
    .in(col, orgIds)
    .eq('scope_type', 'org');
  // Distinct people per org — a dual-edge profile counts once.
  const seen = new Map<string, Set<string>>();
  for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
    if (!seen.has(row[col])) seen.set(row[col], new Set());
    seen.get(row[col])!.add(row.profile_id);
  }
  for (const [orgId, profiles] of seen) counts.set(orgId, profiles.size);
  return counts;
}

/** PATCH route: the owner promotes/demotes between manager and member. */
export async function setMemberRole(
  admin: Admin,
  ref: OrgRef,
  profileId: string,
  role: 'manager' | 'member'
): Promise<WriteResult> {
  const { error } = await admin
    .from('memberships')
    .update({ role })
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org');
  return { error };
}
