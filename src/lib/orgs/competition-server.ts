// ── Competition CRUD — the shared core (phase 2, round 1) ───────────────────
// The structure-server pattern applied to migration 151: the
// /api/admin/competitions* routes and the /api/{side}s/[id]/competitions*
// manager twins all delegate HERE. Cross-row consistency lives in this
// module ONCE: season.org == competition.org (inherited from the season
// row, the divisionCreatePOST recipe); division belongs to that season;
// entrant kind matches entrant_type; entered teams are own-org in v1 (R4
// widens to affiliated orgs, entering as status='pending'); when the
// competition is division-pinned the team must hold a team_entry there;
// ATHLETE entrants resolve through ROSTER-kind memberships only — §8
// invariant 3, the follow edge is never a pipe.
//
// SCOPE is the security crux, verbatim from structure-server:
// `CompetitionScope` non-null pins EVERY read/write to that org (foreign
// ids answer 404, indistinguishable from missing); null = admin unscoped
// by-id semantics. competition_entries has NO org column, so its scoped
// delete verifies through the competition join — the team_entries
// precedent; never "simplify" that to a bare delete.
//
// The gate is `requireCompetitionManager` — the intent seam
// ('manage_competitions', owner-or-manager today) so the masterplan's
// Competition Admin role later specializes roleAllows, not every route.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getOrgAndRole, roleAllows, type OrgSide } from './authz';
import {
  FORMAT_ENTRANTS,
  isMissingTableError,
  type CompetitionCreateInput,
  type CompetitionPatchInput,
  type EntryAddInput,
} from '@/lib/competitions/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface CompetitionScope {
  side: OrgSide;
  orgId: string;
}

const TAG = '[COMPETITIONS]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** The manager gate for the twin routes (admin routes keep requireAdmin).
 *  Same shape as requireOrgManager, on the 'manage_competitions' intent. */
export async function requireCompetitionManager(
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
  if (!roleAllows(loaded.role, 'manage_competitions')) {
    return { ok: false, response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { ok: true, org: { id: loaded.org.id, name: loaded.org.name } };
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** The org's competitions with entries + entrant display names, one
 *  aggregate (the structureAggregateGET shape). Pre-151 degrades to an
 *  empty list, never a 500. */
export async function competitionsAggregateGET(
  admin: Admin,
  scope: CompetitionScope
): Promise<NextResponse> {
  const col = orgColumn(scope.side);

  const { data: competitions, error } = await admin
    .from('competitions')
    .select(
      'id, season_id, division_id, sport_key, name, format, entrant_type, scoring_rule, status, visibility, created_at'
    )
    .eq(col, scope.orgId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ competitions: [] });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load competitions' }, { status: 500 });
  }

  const competitionIds = (competitions ?? []).map(c => c.id);
  const { data: entries } = competitionIds.length
    ? await admin
        .from('competition_entries')
        .select('id, competition_id, team_id, profile_id, status, seed, pool')
        .in('competition_id', competitionIds)
    : { data: [] };

  // Batched display names for both entrant kinds (no N+1).
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id).filter(Boolean))] as string[];
  const profileIds = [...new Set((entries ?? []).map(e => e.profile_id).filter(Boolean))] as string[];
  const [teamsRes, profilesRes, seasonsRes] = await Promise.all([
    teamIds.length
      ? admin.from('teams').select('id, name, display_name').in('id', teamIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length
      ? admin.from('profiles').select('id, first_name, last_name, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from('seasons')
      .select('id, label')
      .in('id', [...new Set((competitions ?? []).map(c => c.season_id))]),
  ]);
  const teamName = new Map(
    (teamsRes.data ?? []).map(t => [t.id, (t.display_name || t.name) as string])
  );
  const profileName = new Map(
    (profilesRes.data ?? []).map(p => [
      p.id,
      ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete') as string,
    ])
  );
  const seasonLabel = new Map((seasonsRes.data ?? []).map(s => [s.id, s.label as string]));

  const entriesByCompetition = new Map<string, unknown[]>();
  for (const e of entries ?? []) {
    if (!entriesByCompetition.has(e.competition_id)) entriesByCompetition.set(e.competition_id, []);
    entriesByCompetition.get(e.competition_id)!.push({
      ...e,
      entrant_name: e.team_id ? (teamName.get(e.team_id) ?? 'Team') : (profileName.get(e.profile_id) ?? 'Athlete'),
    });
  }

  return NextResponse.json({
    competitions: (competitions ?? []).map(c => ({
      ...c,
      season_label: seasonLabel.get(c.season_id) ?? null,
      entries: entriesByCompetition.get(c.id) ?? [],
    })),
  });
}

// ── Competitions ─────────────────────────────────────────────────────────────

export async function competitionCreatePOST(
  admin: Admin,
  scope: CompetitionScope,
  input: CompetitionCreateInput
): Promise<NextResponse> {
  const { data: season } = await admin
    .from('seasons')
    .select('id, league_id, club_id')
    .eq('id', input.seasonId)
    .maybeSingle();
  // A foreign org's season is indistinguishable from a missing one.
  if (!season || season[orgColumn(scope.side)] !== scope.orgId) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  if (input.divisionId) {
    const { data: division } = await admin
      .from('divisions')
      .select('id, season_id')
      .eq('id', input.divisionId)
      .maybeSingle();
    if (!division || division.season_id !== input.seasonId) {
      return NextResponse.json({ error: 'Division not found in that season' }, { status: 404 });
    }
  }

  const { data: competition, error } = await admin
    .from('competitions')
    .insert({
      // Org inherited from the season — the one place the rule is enforced.
      league_id: season.league_id,
      club_id: season.club_id,
      season_id: input.seasonId,
      division_id: input.divisionId ?? null,
      sport_key: input.sportKey,
      name: input.name,
      format: input.format,
      // Entrant type is DERIVED from the format (v1 pairs) — never client-set.
      entrant_type: FORMAT_ENTRANTS[input.format],
      scoring_rule: input.scoringRule ?? null,
      visibility: input.visibility,
    })
    .select()
    .single();
  if (error || !competition) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'A competition with that name already exists in this season' },
        { status: 409 }
      );
    }
    console.error(`${TAG} insert error:`, error);
    return NextResponse.json({ error: 'Failed to create competition' }, { status: 500 });
  }
  return NextResponse.json({ competition });
}

export async function competitionPATCH(
  admin: Admin,
  input: CompetitionPatchInput,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const patch: Record<string, string> = {};
  if (input.status) patch.status = input.status;
  if (input.visibility) patch.visibility = input.visibility;
  let query = admin.from('competitions').update(patch).eq('id', input.id);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: updated, error } = await query.select('id');
  if (error) {
    console.error(`${TAG} patch error:`, error);
    return NextResponse.json({ error: 'Failed to update competition' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }
  return NextResponse.json({ action: 'updated' });
}

/** Admin-only hard delete (the teams recipe: archive is the manager
 *  affordance; the twin routes ship no DELETE). */
export async function competitionDELETE(
  admin: Admin,
  competitionId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  let query = admin.from('competitions').delete().eq('id', competitionId);
  if (scope) query = query.eq(orgColumn(scope.side), scope.orgId);
  const { data: deleted, error } = await query.select('id');
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete competition' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }
  return NextResponse.json({ action: 'deleted' });
}

// ── Entries ──────────────────────────────────────────────────────────────────

export async function entryAddPOST(
  admin: Admin,
  input: EntryAddInput,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const { data: competition } = await admin
    .from('competitions')
    .select('id, league_id, club_id, division_id, entrant_type, status')
    .eq('id', input.competitionId)
    .maybeSingle();
  const comp =
    competition && (!scope || competition[orgColumn(scope.side)] === scope.orgId)
      ? competition
      : null;
  if (!comp) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  if (comp.status === 'completed' || comp.status === 'archived') {
    return NextResponse.json({ error: 'This competition is closed to entries' }, { status: 400 });
  }

  if (comp.entrant_type === 'team') {
    if (!input.teamId) {
      return NextResponse.json({ error: 'This competition takes team entries' }, { status: 400 });
    }
    const { data: team } = await admin
      .from('teams')
      .select('id, league_id, club_id, status')
      .eq('id', input.teamId)
      .maybeSingle();
    // v1: own-org teams only (R4 widens to affiliated orgs as 'pending').
    if (!team || team.league_id !== comp.league_id || team.club_id !== comp.club_id) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    if (team.status === 'archived') {
      return NextResponse.json(
        { error: 'Archived teams can’t be entered — restore first' },
        { status: 400 }
      );
    }
    if (comp.division_id) {
      const { data: teamEntry } = await admin
        .from('team_entries')
        .select('id')
        .eq('team_id', input.teamId)
        .eq('division_id', comp.division_id)
        .maybeSingle();
      if (!teamEntry) {
        return NextResponse.json(
          { error: 'The team isn’t entered in this competition’s division' },
          { status: 400 }
        );
      }
    }
  } else if (comp.entrant_type === 'athlete') {
    if (!input.profileId) {
      return NextResponse.json({ error: 'This competition takes athlete entries' }, { status: 400 });
    }
    // §8 invariant 3: entrants resolve through the ROSTER edge, never
    // follow — an athlete competition is a record surface.
    const { data: rosterRow } = await admin
      .from('memberships')
      .select('id')
      .eq(comp.league_id ? 'league_id' : 'club_id', (comp.league_id ?? comp.club_id) as string)
      .eq('profile_id', input.profileId)
      .eq('kind', 'roster')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (!rosterRow) {
      return NextResponse.json(
        { error: 'Only rostered athletes can be entered' },
        { status: 400 }
      );
    }
  } else {
    // ad_hoc_team is front-loaded in the DB, app-gated off until its round.
    return NextResponse.json({ error: 'This entrant type isn’t available yet' }, { status: 400 });
  }

  const { data: entry, error } = await admin
    .from('competition_entries')
    .insert({
      competition_id: input.competitionId,
      team_id: input.teamId ?? null,
      profile_id: input.profileId ?? null,
    })
    .select()
    .single();
  if (error || !entry) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'Already entered in this competition' }, { status: 409 });
    }
    console.error(`${TAG} entry insert error:`, error);
    return NextResponse.json({ error: 'Failed to add the entry' }, { status: 500 });
  }
  return NextResponse.json({ entry });
}

export async function entryDELETE(
  admin: Admin,
  entryId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  if (scope) {
    // competition_entries has no org column — verify through the
    // competition join BEFORE deleting (the team_entries precedent); a
    // bare delete would let any manager withdraw any org's entries.
    const { data: row } = await admin
      .from('competition_entries')
      .select('id, competition:competition_id (league_id, club_id)')
      .eq('id', entryId)
      .maybeSingle();
    const comp = row?.competition as
      | { league_id: string | null; club_id: string | null }
      | { league_id: string | null; club_id: string | null }[]
      | null
      | undefined;
    const compRow = Array.isArray(comp) ? comp[0] : comp;
    if (!row || !compRow || compRow[orgColumn(scope.side)] !== scope.orgId) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
  }
  const { data: deleted, error } = await admin
    .from('competition_entries')
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
