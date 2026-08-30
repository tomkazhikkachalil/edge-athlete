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
import type { OrgRole, OrgSide } from './authz';
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
// All read from `memberships` with NO kind/status/scope predicate — 0.2 is
// behavior-identical (every row is follow/active/org anyway). 0.10 adds the
// kind='roster' predicate to the CALENDAR MERGE's caller only. Functions own
// the query; callers keep their own error mapping unless every caller shares
// one policy (noted per function). The 0.3 maybeSingle landmine documented
// on getOrgRole applies to getMemberRole identically.

/** Point read of a profile's member row. Callers treat role===null as "not a
 *  member"; the error is surfaced for the join-toggle's 500 branch. */
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
    .maybeSingle();
  return { role: (data?.role as OrgRole | undefined) ?? null, error };
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
    leagueIds: rows.map(r => r.league_id).filter((id): id is string => !!id),
    clubIds: rows.map(r => r.club_id).filter((id): id is string => !!id),
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
  return (data ?? []).map(r => r.profile_id as string);
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
  return { profileIds: (data ?? []).map(r => r.profile_id as string), error };
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
  const rows = ((data ?? []) as unknown as Array<Record<string, string>>).map(r => ({
    orgId: r[col],
    role: r.role,
  }));
  return { rows, error };
}

export interface MemberPreviewRow {
  profile_id: string;
  role: string;
  joined_at: string;
  profile: unknown;
}

/** The org page's member panel: exact count, first `limit` rows with the
 *  embedded profile, and the viewer's own role. Errors read as empty/null —
 *  matching the caller, which uses `data ?? []` with no error branches. */
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
      .eq(col, ref.orgId),
    admin
      .from('memberships')
      .select('profile_id, role, joined_at, profile:profile_id (id, handle, first_name, last_name, full_name, avatar_url)')
      .eq(col, ref.orgId)
      .order('joined_at', { ascending: true })
      .limit(limit),
    viewerId
      ? admin
          .from('memberships')
          .select('role')
          .eq(col, ref.orgId)
          .eq('profile_id', viewerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    count: countRes.count ?? 0,
    members: (membersRes.data ?? []) as unknown as MemberPreviewRow[],
    viewerRole: (viewerRes.data as { role?: string } | null)?.role ?? null,
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
  const { data } = await admin.from('memberships').select(col).in(col, orgIds);
  for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
    counts.set(row[col], (counts.get(row[col]) ?? 0) + 1);
  }
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
