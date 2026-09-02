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
  type ContestCreateInput,
  type ContestPatchInput,
  type EntryAddInput,
  type ResultUpsertInput,
} from '@/lib/competitions/validate';
import {
  mirrorContestChange,
  mirrorContestDelete,
  publishContestToCalendar,
} from '@/lib/competitions/calendar-mirror';
import { recomputeStandingsBestEffort } from '@/lib/competitions/standings';
import {
  revalidateOrgSiteForCompetition,
  revalidateOrgSiteForOrg,
} from '@/lib/org-sites/revalidate';
import { resolveFixtureRule, resolveLeaderboardRule } from '@/lib/competitions/scoring';
import { stampProvenance } from './provenance';

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
    .order('created_at', { ascending: false })
    .limit(100);
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
        // Truncation past PostgREST's silent 1000 cap is data corruption
        // on the console — bound it explicitly (stage-gate fix).
        .limit(1000)
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

  // R4 (league side): teams of ACTIVE member_of/sanctioned_by clubs —
  // the console's rep-entry picker. Reads NOTHING inside the member club
  // beyond team + club names (§5's competition-scope line).
  let affiliatedTeams: { id: string; name: string; club_name: string }[] = [];
  if (scope.side === 'league') {
    const { data: edges } = await admin
      .from('league_clubs')
      .select('club_id, status, affiliation_type')
      .eq('league_id', scope.orgId)
      .eq('status', 'active')
      .in('affiliation_type', ['member_of', 'sanctioned_by'])
      .limit(100);
    const clubIds = [...new Set((edges ?? []).map(e => e.club_id as string))];
    if (clubIds.length) {
      const [clubTeamsRes, clubsRes] = await Promise.all([
        admin
          .from('teams')
          .select('id, name, display_name, club_id')
          .in('club_id', clubIds)
          .eq('status', 'active')
          .order('name')
          .limit(500),
        admin.from('clubs').select('id, name').in('id', clubIds),
      ]);
      const clubName = new Map((clubsRes.data ?? []).map(c => [c.id, c.name as string]));
      affiliatedTeams = (clubTeamsRes.data ?? []).map(t => ({
        id: t.id as string,
        name: (t.display_name || t.name) as string,
        club_name: clubName.get(t.club_id) ?? 'Club',
      }));
    }
  }

  // R5: active roster athletes — the athlete-entry picker (§8 invariant
  // 3: the ROSTER edge is the record edge; follows never appear here).
  const { data: rosterRows } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(col, scope.orgId)
    .eq('scope_type', 'org')
    .eq('kind', 'roster')
    .eq('status', 'active')
    .limit(300);
  const rosterIds = [...new Set((rosterRows ?? []).map(r => r.profile_id as string))];
  const { data: rosterProfiles } = rosterIds.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name').in('id', rosterIds)
    : { data: [] };
  const rosterAthletes = (rosterProfiles ?? []).map(p => ({
    id: p.id as string,
    name: ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete') as string,
  }));

  return NextResponse.json({
    competitions: (competitions ?? []).map(c => ({
      ...c,
      season_label: seasonLabel.get(c.season_id) ?? null,
      entries: entriesByCompetition.get(c.id) ?? [],
    })),
    affiliatedTeams,
    rosterAthletes,
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

  const insertRow: Record<string, unknown> = {
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
  };
  // G1: `config` (172) rides the insert when chosen; a pre-172 database
  // answers PGRST204 and the insert is retried WITHOUT it — the pick
  // silently defaults (first posted) rather than blocking creation.
  let { data: competition, error } = await admin
    .from('competitions')
    .insert(input.config ? { ...insertRow, config: input.config } : insertRow)
    .select()
    .single();
  if (input.config && (error?.code === 'PGRST204' || error?.code === '42703')) {
    ({ data: competition, error } = await admin
      .from('competitions')
      .insert(insertRow)
      .select()
      .single());
  }
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
  // Visibility/status flips change what fetchPublicStandings returns.
  await revalidateOrgSiteForCompetition(admin, input.id);
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
  // Org columns ride the returning select — the freshness hook needs them
  // after the row is gone.
  const { data: deleted, error } = await query.select('id, league_id, club_id');
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete competition' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }
  const delOrgId = (deleted[0].league_id ?? deleted[0].club_id) as string | null;
  if (delOrgId) {
    await revalidateOrgSiteForOrg(admin, deleted[0].league_id ? 'league' : 'club', delOrgId);
  }
  return NextResponse.json({ action: 'deleted' });
}

// ── Entries ──────────────────────────────────────────────────────────────────

export async function entryAddPOST(
  admin: Admin,
  input: EntryAddInput,
  scope: CompetitionScope | null,
  actorId?: string
): Promise<NextResponse> {
  const { data: competition } = await admin
    .from('competitions')
    .select('id, name, league_id, club_id, division_id, entrant_type, status')
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

  let crossOrg: { clubId: string; teamName: string } | null = null;
  if (comp.entrant_type === 'team') {
    if (!input.teamId) {
      return NextResponse.json({ error: 'This competition takes team entries' }, { status: 400 });
    }
    const { data: team } = await admin
      .from('teams')
      .select('id, name, display_name, league_id, club_id, status')
      .eq('id', input.teamId)
      .maybeSingle();
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const sameOrg = team.league_id === comp.league_id && team.club_id === comp.club_id;
    if (!sameOrg) {
      // R4 REP: a foreign team enters IFF the owner is a LEAGUE and an
      // ACTIVE member_of/sanctioned_by edge links it to the team's CLUB
      // (league_clubs is league↔club only). Cross-org authority stays
      // competition-scoped — this reads NOTHING inside the member club
      // beyond the team row (§5's line clubs won't join without).
      if (!comp.league_id || !team.club_id) {
        return NextResponse.json({ error: 'Team not found' }, { status: 404 });
      }
      const { data: edge } = await admin
        .from('league_clubs')
        .select('status, affiliation_type')
        .eq('league_id', comp.league_id)
        .eq('club_id', team.club_id)
        .maybeSingle();
      if (
        !edge ||
        edge.status !== 'active' ||
        !['member_of', 'sanctioned_by'].includes(edge.affiliation_type as string)
      ) {
        return NextResponse.json(
          { error: 'Only teams from affiliated member clubs can be entered' },
          { status: 400 }
        );
      }
      crossOrg = { clubId: team.club_id as string, teamName: (team.display_name || team.name) as string };
    }
    if (team.status === 'archived') {
      return NextResponse.json(
        { error: 'Archived teams can’t be entered — restore first' },
        { status: 400 }
      );
    }
    // The division-entry rule is HOUSE play only — a rep team has no
    // team_entry under the owner league by construction.
    if (comp.division_id && !crossOrg) {
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
    // follow — an athlete competition is a record surface. Phase 5 R1
    // fix: pinned to the ORG scope (a team-scope row used to satisfy the
    // org-level check) and to full membership under the widened lifecycle
    // (active legacy rows and placed registrants; a merely-registered
    // athlete isn't rostered yet).
    const { data: rosterRow } = await admin
      .from('memberships')
      .select('id')
      .eq(comp.league_id ? 'league_id' : 'club_id', (comp.league_id ?? comp.club_id) as string)
      .eq('profile_id', input.profileId)
      .eq('kind', 'roster')
      .eq('scope_type', 'org')
      .in('status', ['active', 'placed'])
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
      // Cross-org entries await the owner's decision (the §5 eligibility
      // step); own-org entries are approved at birth.
      status: crossOrg ? 'pending' : 'approved',
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
  if (crossOrg && comp.league_id) {
    const { notifyEntryPending } = await import('@/lib/competitions/notify');
    await notifyEntryPending(admin, {
      ownerSide: 'league',
      ownerOrgId: comp.league_id,
      competitionId: comp.id,
      competitionName: comp.name as string,
      teamName: crossOrg.teamName,
      actorId: actorId ?? '',
    });
  }
  await recomputeStandingsBestEffort(admin, input.competitionId);
  await revalidateOrgSiteForCompetition(admin, input.competitionId);
  return NextResponse.json({ entry });
}

/** R4: the owner decides a pending entry. Pinned through the competition
 *  join; only pending rows transition; the entering club's managers get
 *  the decided bell. */
export async function entryDecidePATCH(
  admin: Admin,
  input: { entryId: string; decision: 'approved' | 'rejected' },
  scope: CompetitionScope | null,
  actorId: string
): Promise<NextResponse> {
  const { data: row } = await admin
    .from('competition_entries')
    .select(
      'id, status, team_id, competition:competition_id (id, name, league_id, club_id)'
    )
    .eq('id', input.entryId)
    .maybeSingle();
  const comp = row?.competition as
    | { id: string; name: string; league_id: string | null; club_id: string | null }
    | { id: string; name: string; league_id: string | null; club_id: string | null }[]
    | null
    | undefined;
  const compRow = Array.isArray(comp) ? comp[0] : comp;
  if (!row || !compRow || (scope && compRow[orgColumn(scope.side)] !== scope.orgId)) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending entries can be decided' }, { status: 400 });
  }
  const { data: updated, error } = await admin
    .from('competition_entries')
    .update({ status: input.decision })
    .eq('id', input.entryId)
    .eq('status', 'pending')
    .select('id');
  if (error || !updated || updated.length === 0) {
    if (error) console.error(`${TAG} entry decide error:`, error);
    return NextResponse.json({ error: 'Failed to decide the entry' }, { status: 500 });
  }
  if (row.team_id) {
    const { data: team } = await admin
      .from('teams')
      .select('name, display_name, club_id')
      .eq('id', row.team_id)
      .maybeSingle();
    if (team?.club_id) {
      const { notifyEntryDecided } = await import('@/lib/competitions/notify');
      await notifyEntryDecided(admin, {
        clubId: team.club_id as string,
        competitionId: compRow.id,
        competitionName: compRow.name,
        teamName: (team.display_name || team.name) as string,
        decision: input.decision,
        actorId,
      });
    }
  }
  await recomputeStandingsBestEffort(admin, compRow.id);
  await revalidateOrgSiteForCompetition(admin, compRow.id);
  return NextResponse.json({ action: input.decision });
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
    .select('id, competition_id');
  if (error) {
    console.error(`${TAG} entry delete error:`, error);
    return NextResponse.json({ error: 'Failed to remove the entry' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }
  await recomputeStandingsBestEffort(admin, deleted[0].competition_id as string);
  await revalidateOrgSiteForCompetition(admin, deleted[0].competition_id as string);
  return NextResponse.json({ action: 'deleted' });
}

// ── Contests (R2) ────────────────────────────────────────────────────────────

/** Load a competition with the org pin applied. A foreign org's
 *  competition is indistinguishable from a missing one. */
async function pinCompetition(
  admin: Admin,
  competitionId: string,
  scope: CompetitionScope | null
): Promise<{
  id: string;
  league_id: string | null;
  club_id: string | null;
  division_id: string | null;
  format: string;
  entrant_type: string;
  status: string;
  name: string;
} | null> {
  const { data } = await admin
    .from('competitions')
    .select('id, league_id, club_id, division_id, format, entrant_type, status, name')
    .eq('id', competitionId)
    .maybeSingle();
  if (!data) return null;
  if (scope && data[orgColumn(scope.side)] !== scope.orgId) return null;
  return data;
}

/** The competition detail aggregate: entries (with names) + contests
 *  (with participants + results). Feeds the console detail subpage and,
 *  filtered to public, R3's surfaces. Pre-152 the contests read degrades
 *  to an empty schedule. */
export async function competitionDetailGET(
  admin: Admin,
  competitionId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  // One select does both jobs (pin + payload) — the old pinCompetition
  // call re-read the same row with fewer columns.
  const COMP_FIELDS_BASE =
    'id, league_id, club_id, season_id, division_id, sport_key, name, format, entrant_type, scoring_rule, status, visibility, created_at';
  const readFull = (fields: string) => admin.from('competitions').select(fields)
    .eq('id', competitionId)
    .maybeSingle();
  // G1: `config` (172) rides the read; pre-172 retries without it.
  let { data: fullData, error: fullError } = await readFull(`${COMP_FIELDS_BASE}, config`);
  if (fullError?.code === '42703') {
    ({ data: fullData, error: fullError } = await readFull(COMP_FIELDS_BASE));
  }
  const full = fullData as unknown as ({ [key: string]: unknown; format?: string; sport_key?: string; scoring_rule?: string | null } | null);
  if (!full) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  if (scope && full[orgColumn(scope.side)] !== scope.orgId) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }

  const { data: entries } = await admin
    .from('competition_entries')
    .select('id, team_id, profile_id, status, seed, pool')
    .eq('competition_id', competitionId)
    .limit(500);

  const teamIds = [...new Set((entries ?? []).map(e => e.team_id).filter(Boolean))] as string[];
  const profileIds = [...new Set((entries ?? []).map(e => e.profile_id).filter(Boolean))] as string[];
  const [teamsRes, profilesRes] = await Promise.all([
    teamIds.length
      ? admin.from('teams').select('id, name, display_name').in('id', teamIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length
      ? admin.from('profiles').select('id, first_name, last_name, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const teamName = new Map((teamsRes.data ?? []).map(t => [t.id, (t.display_name || t.name) as string]));
  const profileName = new Map(
    (profilesRes.data ?? []).map(p => [
      p.id,
      ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete') as string,
    ])
  );
  const entryName = new Map(
    (entries ?? []).map(e => [
      e.id,
      e.team_id ? (teamName.get(e.team_id) ?? 'Team') : (profileName.get(e.profile_id) ?? 'Athlete'),
    ])
  );

  // G1: the golf columns ride the read; a pre-172 database retries without
  // them (the 42703 pattern).
  const readContests = (fields: string) =>
    admin
      .from('contests')
      .select(fields)
      .eq('competition_id', competitionId)
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  const CONTEST_FIELDS_BASE = 'id, event_id, venue_id, facility_id, scheduled_at, round, status, created_at';
  let { data: contestsData, error: contestsError } = await readContests(
    `${CONTEST_FIELDS_BASE}, holes, play_from, play_to`
  );
  if (contestsError?.code === '42703') {
    ({ data: contestsData, error: contestsError } = await readContests(CONTEST_FIELDS_BASE));
  }
  const contests = contestsData as unknown as
    | {
        id: string;
        event_id: string | null;
        venue_id: string | null;
        facility_id: string | null;
        scheduled_at: string | null;
        round: string | null;
        status: string;
        created_at: string;
        holes?: number | null;
        play_from?: string | null;
        play_to?: string | null;
      }[]
    | null;
  if (contestsError && !isMissingTableError(contestsError.code)) {
    console.error(`${TAG} contests error:`, contestsError);
    return NextResponse.json({ error: 'Failed to load contests' }, { status: 500 });
  }

  const contestIds = (contests ?? []).map(c => c.id);
  const [participantsRes, resultsRes] = contestIds.length
    ? await Promise.all([
        admin
          .from('contest_participants')
          .select('id, contest_id, entry_id, side, start_position')
          .in('contest_id', contestIds)
          .limit(5000),
        admin
          .from('contest_results')
          .select('participant_id, score, payload, provenance, dispute_status')
          .in('contest_id', contestIds)
          .limit(5000),
      ])
    : [{ data: [] }, { data: [] }];

  const resultByParticipant = new Map(
    (resultsRes.data ?? []).map(r => [r.participant_id, r])
  );
  const participantsByContest = new Map<string, unknown[]>();
  for (const p of participantsRes.data ?? []) {
    if (!participantsByContest.has(p.contest_id)) participantsByContest.set(p.contest_id, []);
    participantsByContest.get(p.contest_id)!.push({
      ...p,
      entrant_name: entryName.get(p.entry_id) ?? 'Entrant',
      result: resultByParticipant.get(p.id) ?? null,
    });
  }

  // Standings (R3): the materialized rows + the rule's columns so
  // renderers draw BLINDLY (pre-153 degrades to an empty table).
  const { data: standingRows } = await admin
    .from('competition_standings')
    .select('entry_id, rank, points, played, stats')
    .eq('competition_id', competitionId)
    .order('rank', { ascending: true });
  const rule =
    full?.format === 'fixture'
      ? resolveFixtureRule(full.sport_key as string, full.scoring_rule as string | null)
      : full?.format === 'leaderboard'
        ? resolveLeaderboardRule(full.sport_key as string, full.scoring_rule as string | null)
        : null;

  return NextResponse.json({
    competition: full,
    entries: (entries ?? []).map(e => ({ ...e, entrant_name: entryName.get(e.id) })),
    contests: (contests ?? []).map(c => ({
      ...c,
      participants: participantsByContest.get(c.id) ?? [],
    })),
    standings: (standingRows ?? []).map(r => ({
      ...r,
      entrant_name: entryName.get(r.entry_id) ?? 'Entrant',
    })),
    standingsColumns: rule?.columns ?? [],
  });
}

export async function contestCreatePOST(
  admin: Admin,
  input: ContestCreateInput,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const comp = await pinCompetition(admin, input.competitionId, scope);
  if (!comp) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  if (comp.status === 'completed' || comp.status === 'archived') {
    return NextResponse.json({ error: 'This competition is closed' }, { status: 400 });
  }

  // Fixture contests carry both sides at birth; a LEADERBOARD round (R5)
  // includes every approved entrant automatically.
  let sides: { entry_id: string; side: 'home' | 'away' | null }[] = [];
  if (comp.format === 'leaderboard') {
    const { data: allEntries } = await admin
      .from('competition_entries')
      .select('id, status')
      .eq('competition_id', input.competitionId)
      .limit(500);
    sides = (allEntries ?? [])
      .filter(e => e.status === 'approved')
      .map(e => ({ entry_id: e.id as string, side: null }));
    if (sides.length === 0) {
      return NextResponse.json(
        { error: 'Enter at least one athlete before adding a round' },
        { status: 400 }
      );
    }
  } else if (comp.format === 'fixture') {
    if (!input.homeEntryId || !input.awayEntryId) {
      return NextResponse.json(
        { error: 'A fixture needs a home and an away entry' },
        { status: 400 }
      );
    }
    const { data: entryRows } = await admin
      .from('competition_entries')
      .select('id, status')
      .eq('competition_id', input.competitionId)
      .in('id', [input.homeEntryId, input.awayEntryId]);
    const approved = new Set(
      (entryRows ?? []).filter(e => e.status === 'approved').map(e => e.id)
    );
    if (!approved.has(input.homeEntryId) || !approved.has(input.awayEntryId)) {
      return NextResponse.json(
        { error: 'Both sides must be approved entries of this competition' },
        { status: 400 }
      );
    }
    sides = [
      { entry_id: input.homeEntryId, side: 'home' },
      { entry_id: input.awayEntryId, side: 'away' },
    ];
  }

  const { data: contest, error } = await admin
    .from('contests')
    .insert({
      competition_id: input.competitionId,
      scheduled_at: input.scheduledAt ?? null,
      round: input.round ?? null,
      venue_id: input.venueId ?? null,
      facility_id: input.facilityId ?? null,
      // G1: the golf league round's hole count + play window — sent only
      // when declared, so a pre-172 database still adds plain rounds.
      ...(input.holes ? { holes: input.holes } : {}),
      ...(input.playFrom ? { play_from: input.playFrom } : {}),
      ...(input.playTo ? { play_to: input.playTo } : {}),
    })
    .select()
    .single();
  if (error || !contest) {
    if (error?.code === 'PGRST204' || error?.code === '42703') {
      return NextResponse.json(
        { error: 'Golf league rounds need a database migration first (172)' },
        { status: 409 }
      );
    }
    if (error?.code === '23503') {
      // The composite facility↔venue FK: a facility outside that venue.
      return NextResponse.json(
        { error: 'That facility does not belong to the chosen venue' },
        { status: 400 }
      );
    }
    console.error(`${TAG} contest insert error:`, error);
    return NextResponse.json({ error: 'Failed to create the game' }, { status: 500 });
  }

  if (sides.length) {
    // One homogeneous-key batch (the PGRST102 rule).
    const { error: pError } = await admin.from('contest_participants').insert(
      sides.map(s => ({ contest_id: contest.id, entry_id: s.entry_id, side: s.side }))
    );
    if (pError) {
      // Compensate: a contest without its sides is a broken fixture.
      await admin.from('contests').delete().eq('id', contest.id);
      console.error(`${TAG} participants insert error:`, pError);
      return NextResponse.json({ error: 'Failed to create the game' }, { status: 500 });
    }
  }
  await revalidateOrgSiteForCompetition(admin, contest.competition_id as string);
  return NextResponse.json({ contest });
}

export async function contestPATCH(
  admin: Admin,
  input: ContestPatchInput,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  if (scope) {
    const { data: row } = await admin
      .from('contests')
      .select('id, competition:competition_id (league_id, club_id)')
      .eq('id', input.id)
      .maybeSingle();
    const comp = row?.competition as
      | { league_id: string | null; club_id: string | null }
      | { league_id: string | null; club_id: string | null }[]
      | null
      | undefined;
    const compRow = Array.isArray(comp) ? comp[0] : comp;
    if (!row || !compRow || compRow[orgColumn(scope.side)] !== scope.orgId) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
  }
  const patch: Record<string, unknown> = {};
  if (input.status !== undefined) patch.status = input.status;
  if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt;
  if (input.round !== undefined) patch.round = input.round;
  if (input.venueId !== undefined) patch.venue_id = input.venueId;
  if (input.facilityId !== undefined) patch.facility_id = input.facilityId;
  if (input.holes !== undefined) patch.holes = input.holes;
  if (input.playFrom !== undefined) patch.play_from = input.playFrom;
  if (input.playTo !== undefined) patch.play_to = input.playTo;
  const { data: updated, error } = await admin
    .from('contests')
    .update(patch)
    .eq('id', input.id)
    .select('id, competition_id, event_id, status, scheduled_at');
  if (error) {
    if (error.code === 'PGRST204' || error.code === '42703') {
      return NextResponse.json(
        { error: 'Golf league rounds need a database migration first (172)' },
        { status: 409 }
      );
    }
    if (error.code === '23503') {
      return NextResponse.json(
        { error: 'That facility does not belong to the chosen venue' },
        { status: 400 }
      );
    }
    console.error(`${TAG} contest patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the game' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  // One-way calendar mirror (best-effort — never fails the write).
  await mirrorContestChange(admin, updated[0]);
  // Status flips move games in and out of the table (best-effort).
  if (input.status !== undefined) {
    await recomputeStandingsBestEffort(admin, updated[0].competition_id as string);
  }
  // Time/venue/status changes all reach the public schedule (freshness hook).
  await revalidateOrgSiteForCompetition(admin, updated[0].competition_id as string);
  return NextResponse.json({ action: 'updated', contest: updated[0] });
}

export async function contestDELETE(
  admin: Admin,
  contestId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  if (scope) {
    const { data: row } = await admin
      .from('contests')
      .select('id, competition:competition_id (league_id, club_id)')
      .eq('id', contestId)
      .maybeSingle();
    const comp = row?.competition as
      | { league_id: string | null; club_id: string | null }
      | { league_id: string | null; club_id: string | null }[]
      | null
      | undefined;
    const compRow = Array.isArray(comp) ? comp[0] : comp;
    if (!row || !compRow || compRow[orgColumn(scope.side)] !== scope.orgId) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
  }
  const { data: deleted, error } = await admin
    .from('contests')
    .delete()
    .eq('id', contestId)
    .select('id, competition_id, event_id');
  if (error) {
    console.error(`${TAG} contest delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the game' }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  // The mirror event dies with its contest (best-effort).
  await mirrorContestDelete(admin, deleted[0].event_id as string | null);
  await recomputeStandingsBestEffort(admin, deleted[0].competition_id as string);
  await revalidateOrgSiteForCompetition(admin, deleted[0].competition_id as string);
  return NextResponse.json({ action: 'deleted', contest: deleted[0] });
}

/** Publish a contest to the calendar (idempotent via contests.event_id).
 *  The minted event is division-scoped when the competition is pinned,
 *  org-scoped otherwise — it rides the read-time merge, RSVP, and ICS
 *  rails with zero new plumbing. */
export async function contestPublishPOST(
  admin: Admin,
  contestId: string,
  scope: CompetitionScope | null,
  organizerId: string,
  timezone: string
): Promise<NextResponse> {
  const { data: row } = await admin
    .from('contests')
    .select(
      'id, event_id, scheduled_at, venue_id, facility_id, round, competition:competition_id (id, name, league_id, club_id, division_id)'
    )
    .eq('id', contestId)
    .maybeSingle();
  const comp = row?.competition as
    | { id: string; name: string; league_id: string | null; club_id: string | null; division_id: string | null }
    | { id: string; name: string; league_id: string | null; club_id: string | null; division_id: string | null }[]
    | null
    | undefined;
  const compRow = Array.isArray(comp) ? comp[0] : comp;
  if (!row || !compRow || (scope && compRow[orgColumn(scope.side)] !== scope.orgId)) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const published = await publishContestToCalendar(admin, row, compRow, organizerId, timezone);
  if ('error' in published) {
    return NextResponse.json({ error: published.error }, { status: 400 });
  }
  const pubOrgId = compRow.league_id ?? compRow.club_id;
  if (pubOrgId) {
    await revalidateOrgSiteForOrg(admin, compRow.league_id ? 'league' : 'club', pubOrgId);
  }
  return NextResponse.json({ ok: true, eventId: published.eventId });
}

// ── Results (R2) ─────────────────────────────────────────────────────────────

/** Batch result upsert for one contest. Provenance is stamped via the
 *  shared rule in provenance.ts ('owner' — this path is only reachable
 *  through requireCompetitionManager on the owning org). A fixture
 *  completes automatically once both sides hold a result. */
export async function resultsUpsertPOST(
  admin: Admin,
  input: ResultUpsertInput,
  scope: CompetitionScope | null,
  enteredBy: string
): Promise<NextResponse> {
  const { data: contestRow } = await admin
    .from('contests')
    .select('id, status, competition:competition_id (id, league_id, club_id, format)')
    .eq('id', input.contestId)
    .maybeSingle();
  const comp = contestRow?.competition as
    | { id: string; league_id: string | null; club_id: string | null; format: string }
    | { id: string; league_id: string | null; club_id: string | null; format: string }[]
    | null
    | undefined;
  const compRow = Array.isArray(comp) ? comp[0] : comp;
  if (!contestRow || !compRow || (scope && compRow[orgColumn(scope.side)] !== scope.orgId)) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  if (contestRow.status === 'canceled') {
    return NextResponse.json({ error: 'This game was canceled' }, { status: 400 });
  }

  const { data: participants } = await admin
    .from('contest_participants')
    .select('id, side')
    .eq('contest_id', input.contestId);
  const participantIds = new Set((participants ?? []).map(p => p.id));
  for (const r of input.results) {
    if (!participantIds.has(r.participantId)) {
      return NextResponse.json(
        { error: 'A result references a participant outside this game' },
        { status: 400 }
      );
    }
  }
  if (compRow.format === 'fixture') {
    const sides = new Set((participants ?? []).map(p => p.side));
    if ((participants ?? []).length !== 2 || !sides.has('home') || !sides.has('away')) {
      return NextResponse.json(
        { error: 'A fixture needs exactly one home and one away side' },
        { status: 400 }
      );
    }
  }

  // One homogeneous-key batch upsert on the participant unique.
  const { error } = await admin.from('contest_results').upsert(
    input.results.map(r => ({
      contest_id: input.contestId,
      participant_id: r.participantId,
      score: r.score,
      payload: r.payload ?? {},
      provenance: stampProvenance('owner'),
      entered_by: enteredBy,
    })),
    { onConflict: 'participant_id' }
  );
  if (error) {
    console.error(`${TAG} results upsert error:`, error);
    return NextResponse.json({ error: 'Failed to save the result' }, { status: 500 });
  }

  // Auto-complete once every participant holds a result (head-count, not
  // a row fetch — the B2 rule).
  const { count: resultCount } = await admin
    .from('contest_results')
    .select('participant_id', { count: 'exact', head: true })
    .eq('contest_id', input.contestId);
  const complete =
    (participants ?? []).length > 0 &&
    (resultCount ?? 0) >= (participants ?? []).length;
  if (complete && contestRow.status !== 'completed') {
    await admin.from('contests').update({ status: 'completed' }).eq('id', input.contestId);
  }
  await recomputeStandingsBestEffort(admin, compRow.id);
  await revalidateOrgSiteForCompetition(admin, compRow.id);
  return NextResponse.json({ ok: true, completed: complete, competitionId: compRow.id });
}
