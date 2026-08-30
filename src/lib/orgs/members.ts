// ── Org membership data-access layer (0.2) ──────────────────────────────────
// The ONE place org membership rows are written (and, after the read-switch,
// read). Routes keep their own authorization (orgs/authz.ts) and their own
// response bodies; this module owns the queries.
//
// `memberships` (migration 140) is the ONLY store. The legacy
// league_members/club_members tables are frozen and dropped by a later
// migration once the soak criteria in 140's header are met.
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

/** Org creation: the owner's role='owner' member row. */
export function insertOwnerRow(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  return insertMembership(admin, ref, profileId, 'owner');
}

async function deleteMembership(admin: Admin, ref: OrgRef, profileId: string): Promise<WriteResult> {
  const { error } = await admin
    .from('memberships')
    .delete()
    .eq(orgColumn(ref.side), ref.orgId)
    .eq('profile_id', profileId)
    .eq('kind', 'follow')
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

// ── Reads (the enumeration layer promised by orgs/authz.ts) ─────────────────
// Multi-row aware (0.3): a profile may hold BOTH a follow row and a roster
// row per org, so role reads reduce with maxOrgRole and enumeration reads
// dedupe. Enumeration keeps NO kind predicate — 0.10 adds the kind='roster'
// predicate to the CALENDAR MERGE's caller only. The member-list/count
// queries filter kind='follow' (roster ⊆ follow: one row per person).
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
    .eq('profile_id', profileId);
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
    .eq('profile_id', profileId);
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
    .in(orgColumn(side), orgIds);
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
    .eq(orgColumn(ref.side), ref.orgId);
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
    .eq('profile_id', profileId);
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
): Promise<{ count: number; members: MemberPreviewRow[]; viewerRole: string | null }> {
  const col = orgColumn(ref.side);
  const [countRes, membersRes, viewerRes] = await Promise.all([
    admin
      .from('memberships')
      .select('profile_id', { count: 'exact', head: true })
      .eq(col, ref.orgId)
      .eq('kind', 'follow'),
    admin
      .from('memberships')
      .select('profile_id, role, joined_at, profile:profile_id (id, handle, first_name, last_name, full_name, avatar_url)')
      .eq(col, ref.orgId)
      .eq('kind', 'follow')
      .order('joined_at', { ascending: true })
      .limit(limit),
    viewerId
      ? admin
          .from('memberships')
          .select('role')
          .eq(col, ref.orgId)
          .eq('profile_id', viewerId)
      : Promise.resolve({ data: null }),
  ]);
  const viewerRows = (viewerRes.data ?? []) as Array<{ role: string }>;
  return {
    count: countRes.count ?? 0,
    members: (membersRes.data ?? []) as unknown as MemberPreviewRow[],
    viewerRole: maxOrgRole(viewerRows.map(r => r.role)),
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
    .in(col, orgIds);
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
