// ── Sub-org scope membership readers (0.9) ──────────────────────────────────
// members.ts is ORG-SCOPED BY CHARTER (every read there pins
// scope_type='org'); division/team-scoped rows are a different authority
// surface and live HERE. v1 these run dormant — nothing mints sub-org rows
// yet (0.10's guardian-gated roster flow and phase 1's placement do) — but
// the calendar merge, detail access, RSVP gate and notification fan-out all
// read through them so the moment a row exists the surfaces light up.
//
// STRICT AUDIENCE (Tom, Aug 31): parent-implies-child applies to GRANTS,
// not audience. An org-scope membership never expands into child scopes;
// a team-scope row expands UP — the team, the divisions the team is
// entered in, and the owning org.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export type SubOrgScopeType = 'division' | 'team';

export interface ViewerScopeSet {
  /** Division ids whose events the viewer sees (own division rows + the
   *  divisions their teams are entered in). */
  divisionIds: string[];
  /** Team ids whose events the viewer sees (own team rows). */
  teamIds: string[];
  /** EXTRA owning-org ids implied by scoped rows (a team member sees the
   *  owning org's events) — the caller unions these with memberOrgIds. */
  leagueIds: string[];
  clubIds: string[];
  /** division/team id → owning org id, for org-name decoration. */
  scopeOrg: Map<string, string>;
}

const EMPTY: ViewerScopeSet = {
  divisionIds: [],
  teamIds: [],
  leagueIds: [],
  clubIds: [],
  scopeOrg: new Map(),
};

/** The viewer's sub-org scope set for the calendar merge. Degrades to empty
 *  on a pre-145 database — scoped surfaces simply don't exist yet.
 *  `rosterOnly` (0.10, FEATURE_CALENDAR_ROSTER_ONLY) mirrors the org-scope
 *  predicate: only ACTIVE roster rows place events — without it a future
 *  follow-a-team row would be a placement back door the moment sub-org
 *  rows start being minted. */
export async function viewerScopeSet(
  admin: Admin,
  profileId: string,
  opts?: { rosterOnly?: boolean }
): Promise<ViewerScopeSet> {
  let query = admin
    .from('memberships')
    .select('scope_type, scope_id')
    .eq('profile_id', profileId)
    .in('scope_type', ['division', 'team']);
  if (opts?.rosterOnly) {
    query = query.eq('kind', 'roster').eq('status', 'active');
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.code)) return { ...EMPTY, scopeOrg: new Map() };
    throw error;
  }
  const ownDivisionIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const row of data ?? []) {
    if (!row.scope_id) continue;
    if (row.scope_type === 'division') ownDivisionIds.add(row.scope_id as string);
    if (row.scope_type === 'team') teamIds.add(row.scope_id as string);
  }
  if (ownDivisionIds.size === 0 && teamIds.size === 0) return { ...EMPTY, scopeOrg: new Map() };

  // Team rows expand up: entered divisions + the owning org.
  const divisionIds = new Set(ownDivisionIds);
  if (teamIds.size > 0) {
    const { data: entries } = await admin
      .from('team_entries')
      .select('division_id')
      .in('team_id', [...teamIds]);
    for (const e of entries ?? []) divisionIds.add(e.division_id as string);
  }

  const scopeOrg = new Map<string, string>();
  const leagueIds = new Set<string>();
  const clubIds = new Set<string>();
  const collectOrg = (scopeId: string, leagueId: string | null, clubId: string | null) => {
    const orgId = leagueId ?? clubId;
    if (!orgId) return;
    scopeOrg.set(scopeId, orgId);
    (leagueId ? leagueIds : clubIds).add(orgId);
  };
  const [teamRows, divisionRows] = await Promise.all([
    teamIds.size > 0
      ? admin.from('teams').select('id, league_id, club_id').in('id', [...teamIds])
      : Promise.resolve({ data: [] as { id: string; league_id: string | null; club_id: string | null }[] }),
    divisionIds.size > 0
      ? admin.from('divisions').select('id, league_id, club_id').in('id', [...divisionIds])
      : Promise.resolve({ data: [] as { id: string; league_id: string | null; club_id: string | null }[] }),
  ]);
  for (const t of teamRows.data ?? []) {
    collectOrg(t.id as string, t.league_id as string | null, t.club_id as string | null);
  }
  for (const d of divisionRows.data ?? []) {
    collectOrg(d.id as string, d.league_id as string | null, d.club_id as string | null);
  }

  return {
    divisionIds: [...divisionIds],
    teamIds: [...teamIds],
    leagueIds: [...leagueIds],
    clubIds: [...clubIds],
    scopeOrg,
  };
}

/** True when the profile holds a membership row AT this exact scope —
 *  detail access + RSVP for scoped events. Degrades false pre-145. */
export async function scopedMembershipExists(
  admin: Admin,
  scopeType: SubOrgScopeType,
  scopeId: string,
  profileIds: string[]
): Promise<boolean> {
  if (profileIds.length === 0) return false;
  const { data, error } = await admin
    .from('memberships')
    .select('id')
    .eq('scope_type', scopeType)
    .eq('scope_id', scopeId)
    .in('profile_id', profileIds)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error.code)) return false;
    return false;
  }
  return !!data;
}

/** Distinct member profile ids at one sub-org scope — the scoped
 *  notification fan-out (empty v1). */
export async function scopedMemberProfileIds(
  admin: Admin,
  scopeType: SubOrgScopeType,
  scopeId: string
): Promise<{ profileIds: string[]; error: PostgrestError | null }> {
  const { data, error } = await admin
    .from('memberships')
    .select('profile_id')
    .eq('scope_type', scopeType)
    .eq('scope_id', scopeId);
  if (error) {
    if (isMissingTableError(error.code)) return { profileIds: [], error: null };
    return { profileIds: [], error };
  }
  return { profileIds: [...new Set((data ?? []).map(r => r.profile_id as string))], error: null };
}
