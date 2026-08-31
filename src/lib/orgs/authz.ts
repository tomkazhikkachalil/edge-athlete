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
//    lives behind the data-access layer (src/lib/orgs/members.ts), never
//    behind authz.
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

const ROLE_RANK: Record<OrgRole, number> = { owner: 3, manager: 2, member: 1 };

/** The decided rule (0.3): a profile's org role is the MAX across all their
 *  memberships rows for the org — owner > manager > member. Kind is
 *  orthogonal to role, so a follow row and a roster row coexisting can
 *  never demote anyone, and row order never matters. Unknown strings are
 *  ignored; no rows → null. */
export function maxOrgRole(roles: Array<string | null | undefined>): OrgRole | null {
  let best: OrgRole | null = null;
  for (const role of roles) {
    if (role !== 'owner' && role !== 'manager' && role !== 'member') continue;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

/** The profile's ORG role: MAX across their org-SCOPE rows (0.8 rows-only;
 *  0.5 pins scope_type='org' — a division/team-scoped role must never leak
 *  into org authorization; those scopes get their own readers with
 *  0.9/roles). The org row's owner column is a primary-owner CACHE feeding
 *  display defaults + notification recipients — it grants NOTHING here
 *  (the 0.8 soak fallback died in the phase-0 cleanup: 144's backfill was
 *  a verified no-op and every org since creation gets its owner row from
 *  insertOwnerRow, so zero-rows-with-a-cache-hit cannot occur; the old
 *  ownerProfileId parameter died with it). A failed membership read
 *  yields null — deliberately: authorization degrades to "no role", never
 *  to a 500 here (routes 500 on the ORG fetch instead). */
export async function getOrgRole(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<OrgRole | null> {
  const idColumn = side === 'league' ? 'league_id' : 'club_id';
  const { data } = await admin
    .from('memberships')
    .select('role')
    .eq(idColumn, orgId)
    .eq('profile_id', profileId)
    .eq('scope_type', 'org');
  return maxOrgRole((data ?? []).map(r => r.role as string));
}

export function isOwnerOrManager(role: OrgRole | null): boolean {
  return role === 'owner' || role === 'manager';
}

/** What the caller wants to DO. The role ladder is compared here and only
 *  here, so widening it (or moving to scoped grants) touches this function,
 *  not every route. Today: change_roles is owner-only; everything else is
 *  owner-or-manager. */
export type OrgIntent =
  | 'manage_org'
  | 'manage_members'
  | 'change_roles'
  | 'schedule_events'
  | 'manage_owners';

export function roleAllows(role: OrgRole | null, intent: OrgIntent): boolean {
  if (intent === 'change_roles' || intent === 'manage_owners') return role === 'owner';
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
 *  the route's own log tag + 500 body. Role comes from the memberships
 *  rows (0.8); the owner column rides along as the primary-owner cache. */
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

  const role = await getOrgRole(admin, side, orgId, profileId);
  return { status: 'found', org, role };
}
