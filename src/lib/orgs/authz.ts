// ── Org authorization — the one module that answers "what may THIS profile
// do to THIS org?" ───────────────────────────────────────────────────────────
//
// Moved here from src/lib/affiliations/authz.ts (0.1 of the org-platform
// phase 0). That file's charter scoped it to the affiliation surfaces, but the
// calendar routes were already importing it from outside that charter — this
// move makes the reality official. Two charters, stated so they survive the
// role ladder widening (~10 roles over org|division|team|competition|site
// scopes, per docs/ORG_PLATFORM_MASTERPLAN.md §5):
//
// 1. AUTHORIZATION ONLY. One profile, one org, one decision. Membership
//    ENUMERATION — org lists, member lists, calendar-merge candidate sets —
//    stays at its call sites (org-merge-server, org-peers,
//    getProfileOrganizations) and will move behind a membership data-access
//    layer (src/lib/orgs/members.ts) in 0.2, never behind authz.
// 2. SAFETY BOUNDARY (policy, not convention): org authority NEVER implies
//    family/guardian authority, and vice versa. Guardian checks live in
//    guardian-gate.ts / profile-roles.ts / profile_access reads, forever
//    separate from this module — the same human is often a guardian in one
//    org and a coach in another.
//
// getOrgAndRole is a LOADER, not a gate: routes keep their own 403/404/500
// bodies and log tags. If a thrown-Response gate variant is ever added,
// remember the house rule — callers catch `instanceof Response` and RETURN
// it (Next 16.3 turns a thrown Response into a 500).

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the notify.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export type OrgRole = 'owner' | 'manager' | 'member';
export type OrgSide = 'league' | 'club';

/** The profile's role in an org, from `memberships` + the org row's owner
 *  column (owners hold power even without a member row). A failed
 *  membership read yields null — deliberately: authorization degrades to
 *  "no role", never to a 500 here (routes 500 on the ORG fetch instead).
 *
 *  0.3 LANDMINE — resolve BEFORE minting any kind='roster' row: this
 *  .maybeSingle() is safe only while (org, profile) has at most one
 *  memberships row. A coexisting roster row makes it error (PGRST116) →
 *  role null → managers silently lose power. 0.3 must decide the role
 *  source (roster row wins? max of rows?) and change this query first. */
export async function getOrgRole(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string,
  ownerProfileId: string | null
): Promise<OrgRole | null> {
  if (ownerProfileId && ownerProfileId === profileId) return 'owner';
  const idColumn = side === 'league' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from('memberships')
    .select('role')
    .eq(idColumn, orgId)
    .eq('profile_id', profileId)
    .maybeSingle();
  return (data?.role as OrgRole | undefined) ?? null;
}

export function isOwnerOrManager(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

/** What the caller wants to DO. The role ladder is compared here and only
 *  here, so widening it (or moving to scoped grants) touches this function,
 *  not every route. Today: change_roles is owner-only; everything else is
 *  owner-or-manager. */
export type OrgIntent = 'manage_org' | 'manage_members' | 'change_roles' | 'schedule_events';

export function roleAllows(role: OrgRole | null, intent: OrgIntent): boolean {
  if (intent === 'change_roles') return role === 'owner';
  return role === 'owner' || role === 'manager';
}

export type OrgAndRole =
  | {
      status: 'found';
      org: { id: string; name: string; owner_profile_id: string | null };
      role: OrgRole | null;
    }
  | { status: 'not_found' }
  | { status: 'error'; error: PostgrestError };

/** Load an org row and the profile's role in one call. `not_found` covers
 *  both a missing row and a pre-113/117 database (missing-table codes), which
 *  every route maps to its own 404; `error` carries the PostgrestError for
 *  the route's own log tag + 500 body. The owner-column short-circuit in
 *  getOrgRole means an owner match skips the membership query entirely. */
export async function getOrgAndRole(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<OrgAndRole> {
  const orgTable = side === 'league' ? 'leagues' : 'clubs';

  const { data: org, error } = await admin
    .from(orgTable)
    .select('id, name, owner_profile_id')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) return { status: 'not_found' };
    return { status: 'error', error };
  }
  if (!org) return { status: 'not_found' };

  const role = await getOrgRole(admin, side, orgId, profileId, org.owner_profile_id);
  return { status: 'found', org, role };
}
