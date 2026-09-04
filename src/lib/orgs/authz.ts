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
 *  not every route. change_roles / manage_owners are owner-only; every
 *  other intent is owner-or-manager on the LADDER — and, since the org
 *  staff program (178), a section intent is also satisfied by a matching
 *  staff grant (see capabilityAllows). `manage_org` is the one intent no
 *  section grant reaches: identity, settings, slug/domain, delete — "not
 *  the overall site" (Tom). */
export type OrgIntent =
  | 'manage_org'
  | 'manage_members'
  | 'change_roles'
  | 'schedule_events'
  | 'manage_owners'
  | 'manage_competitions'
  // Phase 5: registrations, placements, windows — the masterplan's
  // Registrar seam; owner-or-manager today, a dedicated role later.
  | 'manage_registration'
  // Org staff program (178): one intent per console section that did not
  // have one. Routes adopt them family by family (round 3); until a route
  // passes one, its gate stays `manage_org`.
  | 'manage_site'
  | 'manage_membership'
  | 'manage_structure'
  | 'manage_teams'
  | 'manage_affiliations'
  | 'manage_venues'
  // The console's read aggregates (structure GET): anyone who may enter the
  // console at all — ladder, admin, or any section grant.
  | 'enter_console';

export function roleAllows(role: OrgRole | null, intent: OrgIntent): boolean {
  if (intent === 'change_roles' || intent === 'manage_owners') return role === 'owner';
  return role === 'owner' || role === 'manager';
}

// ── Section grants (org staff program, 178) ─────────────────────────────────
// A staff grant is a `kind='staff'` memberships row: role 'admin' (every
// section, org scope) or role 'staff' with `sections` ⊆ ORG_SECTIONS at
// org | division | team scope. The nine keys ARE the console's section
// vocabulary — one list for the DB CHECK, the invite form, the console and
// this module. Rules (masterplan §5): grants are additive (a union); parent
// scope implies child scope (a division grant covers the division's
// teams), never the reverse; expired rows are inert; and the safety
// boundary above holds — nothing here reads guardian data.

export const ORG_SECTIONS = [
  'website', 'roster', 'membership', 'seasons', 'teams',
  'competitions', 'registrations', 'external', 'venues',
] as const;
export type OrgSection = (typeof ORG_SECTIONS)[number];

export function isOrgSection(value: unknown): value is OrgSection {
  return (ORG_SECTIONS as readonly string[]).includes(value as string);
}

/** Which section satisfies each intent. Intents absent here (`manage_org`,
 *  `change_roles`, `manage_owners`) are ladder-only by design. */
export const INTENT_SECTION: Partial<Record<OrgIntent, OrgSection>> = {
  manage_site: 'website',
  manage_members: 'roster',
  manage_membership: 'membership',
  manage_structure: 'seasons',
  manage_teams: 'teams',
  manage_competitions: 'competitions',
  schedule_events: 'competitions',
  manage_registration: 'registrations',
  manage_affiliations: 'external',
  manage_venues: 'venues',
};

export type StaffScopeType = 'division' | 'team';

export interface ScopedGrant {
  scopeType: StaffScopeType;
  scopeId: string;
  sections: OrgSection[];
}

export interface OrgCapabilities {
  /** The ladder role from the follow rows (owner > manager > member). */
  role: OrgRole | null;
  /** A live `admin` staff row at org scope — every section, never manage_org. */
  admin: boolean;
  /** Org-wide sections from live `staff` rows at org scope. */
  sections: OrgSection[];
  /** Division / team grants from live `staff` rows. */
  scoped: ScopedGrant[];
}

export const NO_CAPABILITIES: OrgCapabilities = { role: null, admin: false, sections: [], scoped: [] };

export interface CapabilityRow {
  role: string | null;
  kind?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
  sections?: string[] | null;
  expires_at?: string | null;
}

/** The pure reduction: memberships rows → capabilities. Follow rows feed the
 *  ladder (maxOrgRole, org scope only — a scoped role must never leak into
 *  org authorization); staff rows feed admin/sections/scoped. A row whose
 *  expires_at is at or before `now` is skipped. Unknown role strings and
 *  unknown section keys are ignored, so a future widening cannot grant by
 *  accident. */
export function capabilitiesFromRows(rows: CapabilityRow[], now: Date = new Date()): OrgCapabilities {
  const ladder: string[] = [];
  let admin = false;
  const orgSections = new Set<OrgSection>();
  const scopedMap = new Map<string, ScopedGrant>();
  for (const row of rows) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) continue;
    const scopeType = row.scope_type ?? 'org';
    if (row.kind !== 'staff') {
      if (scopeType === 'org') ladder.push(row.role ?? '');
      continue;
    }
    if (row.role === 'admin') {
      if (scopeType === 'org') admin = true;
      continue;
    }
    if (row.role !== 'staff') continue;
    const sections = (row.sections ?? []).filter(isOrgSection);
    if (sections.length === 0) continue;
    if (scopeType === 'org') {
      for (const s of sections) orgSections.add(s);
      continue;
    }
    if ((scopeType !== 'division' && scopeType !== 'team') || !row.scope_id) continue;
    const key = `${scopeType}:${row.scope_id}`;
    const existing = scopedMap.get(key);
    if (existing) {
      for (const s of sections) if (!existing.sections.includes(s)) existing.sections.push(s);
    } else {
      scopedMap.set(key, { scopeType, scopeId: row.scope_id, sections: [...sections] });
    }
  }
  return {
    role: maxOrgRole(ladder),
    admin,
    sections: ORG_SECTIONS.filter(s => orgSections.has(s)),
    scoped: [...scopedMap.values()],
  };
}

/** True when the profile can enter the console at all. */
export function hasAnyCapability(caps: OrgCapabilities): boolean {
  return isOwnerOrManager(caps.role) || caps.admin || caps.sections.length > 0 || caps.scoped.length > 0;
}

/** The sections the console shows: everything for the ladder/admin, else
 *  the union of org-wide and scoped grants. */
export function visibleSections(caps: OrgCapabilities): OrgSection[] {
  if (isOwnerOrManager(caps.role) || caps.admin) return [...ORG_SECTIONS];
  const set = new Set<OrgSection>(caps.sections);
  for (const g of caps.scoped) for (const s of g.sections) set.add(s);
  return ORG_SECTIONS.filter(s => set.has(s));
}

export interface IntentScope {
  type: StaffScopeType;
  id: string;
  /** For a team scope: the divisions the team is entered in — a division
   *  grant covers them (parent implies child). The caller resolves these
   *  (scoped-members' divisionIdsForTeam); omitted = no parent match. */
  parentDivisionIds?: string[];
}

/** The decision. Owner-only intents and `manage_org` are ladder (or admin)
 *  only; a section intent is also satisfied by an org-wide grant on its
 *  section, or — when the caller names the scope being written — by a
 *  scoped grant on that exact scope or on a parent division. A scoped grant
 *  never satisfies an org-level (scope-less) write. */
export function capabilityAllows(caps: OrgCapabilities, intent: OrgIntent, scope?: IntentScope): boolean {
  if (intent === 'change_roles' || intent === 'manage_owners') return caps.role === 'owner';
  if (intent === 'enter_console') return hasAnyCapability(caps);
  if (roleAllows(caps.role, intent) || caps.admin) return true;
  const section = INTENT_SECTION[intent];
  if (!section) return false;
  if (caps.sections.includes(section)) return true;
  if (!scope) return false;
  return caps.scoped.some(g => {
    if (!g.sections.includes(section)) return false;
    if (g.scopeType === scope.type && g.scopeId === scope.id) return true;
    return g.scopeType === 'division' && scope.type === 'team'
      && (scope.parentDivisionIds ?? []).includes(g.scopeId);
  });
}

/** The profile's capabilities for one org: one read over their follow +
 *  staff rows. 42703-safe: on a pre-178 database (no `sections` column) it
 *  falls back to the ladder alone, so every existing gate keeps its exact
 *  behaviour; any other failure degrades to no capabilities, never a 500. */
export async function getOrgCapabilities(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<OrgCapabilities> {
  const idColumn = side === 'league' ? 'league_id' : 'club_id';
  const { data, error } = await admin
    .from('memberships')
    .select('role, kind, scope_type, scope_id, sections, expires_at')
    .eq(idColumn, orgId)
    .eq('profile_id', profileId)
    .in('kind', ['follow', 'staff']);
  if (error) {
    const role = await getOrgRole(admin, side, orgId, profileId);
    return { ...NO_CAPABILITIES, role };
  }
  return capabilitiesFromRows((data ?? []) as CapabilityRow[]);
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

export type OrgAndCapabilities =
  | {
      status: 'found';
      org: { id: string; name: string; owner_profile_id: string | null };
      caps: OrgCapabilities;
    }
  | { status: 'not_found' }
  | { status: 'error'; error: PostgrestError };

/** getOrgAndRole's twin for capability-aware gates (178): the org row plus
 *  the profile's full capabilities. Same status contract. */
export async function getOrgAndCapabilities(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<OrgAndCapabilities> {
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
  const caps = await getOrgCapabilities(admin, side, orgId, profileId);
  return { status: 'found', org, caps };
}
