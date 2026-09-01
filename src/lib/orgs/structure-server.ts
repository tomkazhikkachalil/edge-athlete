// ── Program structure CRUD — the shared core (phase 1, round 1) ─────────────
// The roster-server pattern crossed with structure-options' gate: the five
// /api/admin/structure/* routes and the ten /api/{side}s/[id]/structure/*
// manager twins all delegate HERE. The cross-row consistency rules live in
// this module ONCE (division.org == season.org; team.org == division.org;
// archived teams can't be entered), as does the league sport-cache refresh
// (0.6b, warn-and-continue — a stale sport chip never fails a write).
//
// SCOPE is the security crux. `StructureScope` non-null pins EVERY child
// read/write to that org (manager routes — a manager must never touch
// another org's rows, and cross-org ids answer 404, indistinguishable from
// missing); null = the admin console's unscoped by-id semantics, byte-for-
// byte what shipped in 0.5. team_entries has NO org column, so its scoped
// delete verifies through the division join — never "simplify" that to a
// bare delete.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getOrgAndRole, roleAllows, type OrgSide } from './authz';
import { refreshLeagueSportCache } from './sports';
import {
  isMissingTableError,
  type DivisionCreateInput,
  type EntryCreateInput,
  type SeasonCreateInput,
  type TeamCreateInput,
  type TeamPatchInput,
} from '@/lib/structure/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface StructureScope {
  side: OrgSide;
  orgId: string;
}

const TAG = '[ORG STRUCTURE]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** The manager gate for the twin routes (admin routes keep requireAdmin).
 *  structure-options' exact mapping, intent 'manage_org' — the intended,
 *  previously-unused gate. */
export async function requireOrgManager(
  admin: Admin,
  user: User,
  side: OrgSide,
  orgId: string
): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; response: NextResponse }> {
  const loaded = await getOrgAndRole(admin, side, orgId, user.id);
  if (loaded.status === 'error') {
    console.error(`${TAG} org fetch error:`, loaded.error);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Failed to load organization' }, { status: 500 }),
    };
  }
  if (loaded.status === 'not_found') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: side === 'league' ? 'League not found' : 'Club not found' },
        { status: 404 }
      ),
    };
  }
  if (!roleAllows(loaded.role, 'manage_org')) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { ok: true, org: { id: loaded.org.id, name: loaded.org.name } };
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** The ONE aggregate: seasons → divisions → entries, plus the org's teams.
 *  `includeCounts` (manager console) adds the checklist's two membership
 *  head-counts. Pre-145 degrades to an empty console, never a 500. */
export async function structureAggregateGET(
  admin: Admin,
  scope: StructureScope,
  opts?: { includeCounts?: boolean }
): Promise<NextResponse> {
  const col = orgColumn(scope.side);

  const { data: seasons, error } = await admin
    .from('seasons')
    .select('id, label, starts_on, ends_on, sport_key, created_at')
    .eq(col, scope.orgId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ seasons: [], teams: [] });
    console.error(`${TAG} seasons error:`, error);
    return NextResponse.json({ error: 'Failed to load structure' }, { status: 500 });
  }

  const seasonIds = (seasons ?? []).map(s => s.id);
  const [divisionsRes, teamsRes] = await Promise.all([
    seasonIds.length
      ? admin
          .from('divisions')
          .select('id, season_id, sport_key, name, age_band, gender_stream, tier, capacity_estimate')
          .in('season_id', seasonIds)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from('teams')
      .select('id, name, display_name, status, created_at')
      .eq(col, scope.orgId)
      .order('name', { ascending: true }),
  ]);

  const divisions = divisionsRes.data ?? [];
  const divisionIds = divisions.map(d => d.id);
  const { data: entries } = divisionIds.length
    ? await admin.from('team_entries').select('id, team_id, division_id').in('division_id', divisionIds)
    : { data: [] };

  const entriesByDivision = new Map<string, Array<{ id: string; team_id: string }>>();
  for (const e of entries ?? []) {
    if (!entriesByDivision.has(e.division_id)) entriesByDivision.set(e.division_id, []);
    entriesByDivision.get(e.division_id)!.push({ id: e.id, team_id: e.team_id });
  }
  const divisionsBySeason = new Map<string, unknown[]>();
  for (const d of divisions) {
    if (!divisionsBySeason.has(d.season_id)) divisionsBySeason.set(d.season_id, []);
    divisionsBySeason.get(d.season_id)!.push({ ...d, entries: entriesByDivision.get(d.id) ?? [] });
  }

  let counts: { managers: number; rosterAthletes: number } | undefined;
  if (opts?.includeCounts) {
    const [managersRes, rosterRes] = await Promise.all([
      admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq(col, scope.orgId)
        .eq('scope_type', 'org')
        .eq('kind', 'follow')
        .in('role', ['owner', 'manager']),
      admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq(col, scope.orgId)
        .eq('kind', 'roster')
        // Phase 5 R1 fix: org-scope pin (a placed athlete used to count
        // twice via their team row) + "on the roster" semantics under the
        // widened lifecycle: active (legacy) and placed count; registered/
        // evaluating surface separately on the registrar screen (R4).
        .eq('scope_type', 'org')
        .in('status', ['active', 'placed']),
    ]);
    counts = { managers: managersRes.count ?? 0, rosterAthletes: rosterRes.count ?? 0 };
  }

  return NextResponse.json({
    seasons: (seasons ?? []).map(s => ({ ...s, divisions: divisionsBySeason.get(s.id) ?? [] })),
    teams: teamsRes.data ?? [],
    ...(counts ? { counts } : {}),
  });
}

// ── Seasons ──────────────────────────────────────────────────────────────────

export async function seasonCreatePOST(
  admin: Admin,
  scope: StructureScope,
  input: SeasonCreateInput
): Promise<NextResponse> {
  const { data: org } = await admin
    .from(scope.side === 'league' ? 'leagues' : 'clubs')
    .select('id')
    .eq('id', scope.orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json(
      { error: scope.side === 'league' ? 'League not found' : 'Club not found' },
      { status: 404 }
    );
  }

  const { data: season, error } = await admin
    .from('seasons')
    .insert({
      [orgColumn(scope.side)]: scope.orgId,
      label: input.label,
      starts_on: input.startsOn ?? null,
      ends_on: input.endsOn ?? null,
      sport_key: input.sportKey ?? null,
    })
    .select()
    .single();
  if (error || !season) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A season with that label already exists' }, { status: 409 });
    }
    console.error(`${TAG} season insert error:`, error);
    return NextResponse.json({ error: 'Failed to create season' }, { status: 500 });
  }
  return NextResponse.json({ season });
}

export async function seasonDELETE(
  admin: Admin,
  seasonId: string,
  scope: StructureScope | null
): Promise<NextResponse> {
  let query = admin.from('seasons').delete().eq('id', seasonId);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: deleted, error } = await query.select('id, league_id');
  if (error) {
    console.error(`${TAG} season delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete season' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }
  // The delete cascaded this season's divisions — refresh the sport cache
  // (0.6b, league side only; warn-and-continue).
  if (deleted[0].league_id) {
    const { error: cacheError } = await refreshLeagueSportCache(admin, deleted[0].league_id as string);
    if (cacheError) console.warn(`${TAG} sport cache refresh failed:`, cacheError.message);
  }
  return NextResponse.json({ action: 'deleted' });
}

// ── Divisions ────────────────────────────────────────────────────────────────

export async function divisionCreatePOST(
  admin: Admin,
  input: DivisionCreateInput,
  scope: StructureScope | null
): Promise<NextResponse> {
  const { data: season } = await admin
    .from('seasons')
    .select('id, league_id, club_id')
    .eq('id', input.seasonId)
    .maybeSingle();
  // A foreign org's season is indistinguishable from a missing one.
  if (!season || (scope && season[orgColumn(scope.side)] !== scope.orgId)) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  const { data: division, error } = await admin
    .from('divisions')
    .insert({
      // Org inherited from the season — the one place the rule is enforced.
      league_id: season.league_id,
      club_id: season.club_id,
      season_id: input.seasonId,
      sport_key: input.sportKey,
      name: input.name,
      age_band: input.ageBand ?? null,
      gender_stream: input.genderStream ?? null,
      tier: input.tier ?? null,
      capacity_estimate: input.capacityEstimate ?? null,
    })
    .select()
    .single();
  if (error || !division) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'A division with that name already exists in this season' },
        { status: 409 }
      );
    }
    console.error(`${TAG} division insert error:`, error);
    return NextResponse.json({ error: 'Failed to create division' }, { status: 500 });
  }
  if (season.league_id) {
    const { error: cacheError } = await refreshLeagueSportCache(admin, season.league_id as string);
    if (cacheError) console.warn(`${TAG} sport cache refresh failed:`, cacheError.message);
  }
  return NextResponse.json({ division });
}

export async function divisionDELETE(
  admin: Admin,
  divisionId: string,
  scope: StructureScope | null
): Promise<NextResponse> {
  let query = admin.from('divisions').delete().eq('id', divisionId);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: deleted, error } = await query.select('id, league_id');
  if (error) {
    console.error(`${TAG} division delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete division' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Division not found' }, { status: 404 });
  }
  if (deleted[0].league_id) {
    const { error: cacheError } = await refreshLeagueSportCache(admin, deleted[0].league_id as string);
    if (cacheError) console.warn(`${TAG} sport cache refresh failed:`, cacheError.message);
  }
  return NextResponse.json({ action: 'deleted' });
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function teamCreatePOST(
  admin: Admin,
  scope: StructureScope,
  input: TeamCreateInput
): Promise<NextResponse> {
  const { data: org } = await admin
    .from(scope.side === 'league' ? 'leagues' : 'clubs')
    .select('id')
    .eq('id', scope.orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json(
      { error: scope.side === 'league' ? 'League not found' : 'Club not found' },
      { status: 404 }
    );
  }

  const { data: team, error } = await admin
    .from('teams')
    .insert({
      [orgColumn(scope.side)]: scope.orgId,
      name: input.name,
      display_name: input.displayName ?? null,
    })
    .select()
    .single();
  if (error || !team) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A team with that name already exists' }, { status: 409 });
    }
    console.error(`${TAG} team insert error:`, error);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
  return NextResponse.json({ team });
}

export async function teamPATCH(
  admin: Admin,
  input: TeamPatchInput,
  scope: StructureScope | null
): Promise<NextResponse> {
  let query = admin.from('teams').update({ status: input.status }).eq('id', input.id);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: updated, error } = await query.select('id');
  if (error) {
    console.error(`${TAG} team patch error:`, error);
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }
  return NextResponse.json({ action: input.status === 'archived' ? 'archived' : 'restored' });
}

export async function teamDELETE(
  admin: Admin,
  teamId: string,
  scope: StructureScope | null
): Promise<NextResponse> {
  let query = admin.from('teams').delete().eq('id', teamId);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: deleted, error } = await query.select('id');
  if (error) {
    console.error(`${TAG} team delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }
  return NextResponse.json({ action: 'deleted' });
}

// ── Entries ──────────────────────────────────────────────────────────────────

export async function entryCreatePOST(
  admin: Admin,
  input: EntryCreateInput,
  scope: StructureScope | null
): Promise<NextResponse> {
  const [teamRes, divisionRes] = await Promise.all([
    admin.from('teams').select('id, league_id, club_id, status').eq('id', input.teamId).maybeSingle(),
    admin.from('divisions').select('id, league_id, club_id').eq('id', input.divisionId).maybeSingle(),
  ]);
  // Scoped: a foreign org's rows are indistinguishable from missing ones.
  const team =
    teamRes.data && (!scope || teamRes.data[orgColumn(scope.side)] === scope.orgId)
      ? teamRes.data
      : null;
  const division =
    divisionRes.data && (!scope || divisionRes.data[orgColumn(scope.side)] === scope.orgId)
      ? divisionRes.data
      : null;
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (!division) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
  if (team.league_id !== division.league_id || team.club_id !== division.club_id) {
    return NextResponse.json(
      { error: 'The team and division belong to different organizations' },
      { status: 400 }
    );
  }
  if (team.status === 'archived') {
    return NextResponse.json(
      { error: 'Archived teams can’t be entered — restore first' },
      { status: 400 }
    );
  }

  const { data: entry, error } = await admin
    .from('team_entries')
    .insert({ team_id: input.teamId, division_id: input.divisionId })
    .select()
    .single();
  if (error || !entry) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Already entered in this division' }, { status: 409 });
    }
    console.error(`${TAG} entry insert error:`, error);
    return NextResponse.json({ error: 'Failed to enter the team' }, { status: 500 });
  }
  return NextResponse.json({ entry });
}

export async function entryDELETE(
  admin: Admin,
  entryId: string,
  scope: StructureScope | null
): Promise<NextResponse> {
  if (scope) {
    // team_entries has no org column — verify through the division join
    // BEFORE deleting; a bare delete here would let any manager withdraw
    // any org's entries.
    const { data: row } = await admin
      .from('team_entries')
      .select('id, division:division_id (league_id, club_id)')
      .eq('id', entryId)
      .maybeSingle();
    const division = row?.division as
      | { league_id: string | null; club_id: string | null }
      | { league_id: string | null; club_id: string | null }[]
      | null
      | undefined;
    const divisionRow = Array.isArray(division) ? division[0] : division;
    if (!row || !divisionRow || divisionRow[orgColumn(scope.side)] !== scope.orgId) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
  }
  const { data: deleted, error } = await admin
    .from('team_entries')
    .delete()
    .eq('id', entryId)
    .select('id');
  if (error) {
    console.error(`${TAG} entry delete error:`, error);
    return NextResponse.json({ error: 'Failed to remove the entry' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }
  return NextResponse.json({ action: 'deleted' });
}
