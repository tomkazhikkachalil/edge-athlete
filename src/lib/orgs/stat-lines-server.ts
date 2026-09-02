// ── Contest stat lines — the shared core (phase 4, R1, mig 157) ─────────────
// The competition-server pattern in its own module (that file is 1000+
// lines). Per-athlete stats on a FIXTURE contest: the missing hop between
// the 152 result chain (which bottoms out at competition_entries.team_id)
// and the athlete profile (phase 4 R2 reads idx_contest_stat_lines_profile).
//
// TWO authorities, resolved server-side and never claimed by the client:
//   owner       — manager of the org that owns the competition (the
//                 requireCompetitionManager gate) ⇒ stamps 'league_verified'
//   participant — manager of a CLUB holding an approved team entry in a
//                 competition it does not own (Tom's R1 call: team staff
//                 enter stats for their own players) ⇒ 'club_recorded',
//                 allowed teams pinned to that club's entered teams, and
//                 the no-silent-downgrade rule: a league-verified line is
//                 never overwritable by club staff.
//
// THE ATTRIBUTION GATE (§8 invariant 3): a stat line may only name a
// profile holding an ACTIVE ROSTER membership (kind='roster',
// status='active', scope_type='team') on the participating team it is
// recorded for. Follow rows are never a pipe — do not relax the filter.
//
// Stat keys are validated against STAT_SCHEMAS[competition.sport_key]
// (the posts.stats_data vocabulary — one language for self-posted and
// official stats). Sports without a stat-line schema (golf) answer a
// friendly error. Pre-157 databases degrade: reads answer empty with
// linesAvailable:false, writes answer a friendly error.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { isMissingTableError, type StatLinesUpsertInput } from '@/lib/competitions/validate';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';
import type { CompetitionScope } from './competition-server';
import { canOverwriteProvenance, stampProvenance, type ResultProvenance } from './provenance';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[STAT LINES]';

export interface CompRow {
  id: string;
  name: string;
  sport_key: string;
  format: string;
  status: string;
  league_id: string | null;
  club_id: string | null;
}

export type CompetitionAccess =
  | { authority: 'owner' }
  | { authority: 'participant'; clubTeamIds: Set<string> };

type Access = CompetitionAccess;

/** Resolve how (and whether) the scoped org may touch this competition's
 *  stat lines (and, since R3, its contest media — contest-media-server
 *  rides the same rule). Owner = the scope org owns the competition (or
 *  admin unscoped). Participant = a CLUB scope holding at least one
 *  approved team entry — its authority is pinned to its own entered
 *  teams. */
export async function resolveCompetitionAccess(
  admin: Admin,
  comp: CompRow,
  scope: CompetitionScope | null
): Promise<Access | null> {
  if (!scope) return { authority: 'owner' };
  const ownOrgId = scope.side === 'league' ? comp.league_id : comp.club_id;
  if (ownOrgId === scope.orgId) return { authority: 'owner' };
  if (scope.side !== 'club') return null;
  const { data: entries } = await admin
    .from('competition_entries')
    .select('team_id')
    .eq('competition_id', comp.id)
    .eq('status', 'approved')
    .not('team_id', 'is', null)
    .limit(500);
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id as string))];
  if (teamIds.length === 0) return null;
  const { data: clubTeams } = await admin
    .from('teams')
    .select('id')
    .in('id', teamIds)
    .eq('club_id', scope.orgId);
  const clubTeamIds = new Set((clubTeams ?? []).map(t => t.id as string));
  return clubTeamIds.size > 0 ? { authority: 'participant', clubTeamIds } : null;
}

/** ACTIVE-ROSTER profile ids per team — THE attribution edge. */
export async function rosterByTeam(
  admin: Admin,
  teamIds: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (teamIds.length === 0) return map;
  const { data } = await admin
    .from('memberships')
    .select('profile_id, scope_id')
    .eq('kind', 'roster')
    .eq('status', 'active')
    .eq('scope_type', 'team')
    .in('scope_id', teamIds)
    .limit(1000);
  for (const row of data ?? []) {
    const teamId = row.scope_id as string;
    if (!map.has(teamId)) map.set(teamId, new Set());
    map.get(teamId)!.add(row.profile_id as string);
  }
  return map;
}

/** Everything the player-stats surface needs for one competition, in one
 *  aggregate: contests with their sides, per-team rosters (names are
 *  manager-facing — this route sits behind an org-manager gate), and the
 *  existing lines. Also the participant console's whole data source — it
 *  deliberately does NOT expose entries/standings management. */
export async function statLinesAggregateGET(
  admin: Admin,
  competitionId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const { data: comp } = await admin
    .from('competitions')
    .select('id, name, sport_key, format, status, league_id, club_id')
    .eq('id', competitionId)
    .maybeSingle();
  if (!comp) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, comp as CompRow, scope);
  if (!access) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  if (comp.format !== 'fixture') {
    return NextResponse.json(
      { error: 'Player stats apply to team competitions' },
      { status: 400 }
    );
  }

  const { data: contests } = await admin
    .from('contests')
    .select('id, round, scheduled_at, status')
    .eq('competition_id', comp.id)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(200);
  const contestIds = (contests ?? []).map(c => c.id as string);

  const { data: participants } = contestIds.length
    ? await admin
        .from('contest_participants')
        .select('id, contest_id, side, entry:entry_id (team_id)')
        .in('contest_id', contestIds)
        .limit(1000)
    : { data: [] };
  const participatingTeamIds = new Set<string>();
  const sidesByContest = new Map<
    string,
    { participantId: string; side: string | null; teamId: string | null }[]
  >();
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    const teamId = (entry?.team_id as string | null) ?? null;
    if (teamId) participatingTeamIds.add(teamId);
    const contestId = p.contest_id as string;
    if (!sidesByContest.has(contestId)) sidesByContest.set(contestId, []);
    sidesByContest.get(contestId)!.push({
      participantId: p.id as string,
      side: (p.side as string | null) ?? null,
      teamId,
    });
  }

  // Participant authority sees (and rosters) only its own entered teams.
  const visibleTeamIds =
    access.authority === 'owner'
      ? [...participatingTeamIds]
      : [...participatingTeamIds].filter(id => access.clubTeamIds.has(id));

  const { data: teamRows } = participatingTeamIds.size
    ? await admin
        .from('teams')
        .select('id, name, display_name')
        .in('id', [...participatingTeamIds])
    : { data: [] };
  const teamNames = new Map(
    (teamRows ?? []).map(t => [
      t.id as string,
      ((t.display_name as string | null) || (t.name as string)) ?? 'Team',
    ])
  );

  const roster = await rosterByTeam(admin, visibleTeamIds);
  const rosterProfileIds = [...new Set([...roster.values()].flatMap(s => [...s]))];
  const { data: profileRows } = rosterProfileIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, full_name')
        .in('id', rosterProfileIds)
    : { data: [] };
  const names = new Map(
    (profileRows ?? []).map(p => [
      p.id as string,
      ((p.full_name as string | null) ||
        `${(p.first_name as string | null) ?? ''} ${(p.last_name as string | null) ?? ''}`.trim()) ||
        'Athlete',
    ])
  );

  let lines: {
    id: string;
    contest_id: string;
    team_id: string | null;
    profile_id: string;
    stats: Record<string, number>;
    provenance: string;
  }[] = [];
  let linesAvailable = true;
  if (contestIds.length) {
    const { data, error } = await admin
      .from('contest_stat_lines')
      .select('id, contest_id, team_id, profile_id, stats, provenance')
      .in('contest_id', contestIds)
      .limit(1000);
    if (error) {
      if (!isMissingTableError(error.code)) {
        console.error(`${TAG} lines read error:`, error);
      }
      linesAvailable = false;
    } else {
      lines = (data ?? []) as typeof lines;
      if (access.authority === 'participant') {
        lines = lines.filter(l => l.team_id !== null && access.clubTeamIds.has(l.team_id));
      }
    }
  }

  return NextResponse.json({
    competition: {
      id: comp.id,
      name: comp.name,
      sportKey: comp.sport_key,
      format: comp.format,
      status: comp.status,
      access: access.authority,
    },
    contests: (contests ?? []).map(c => ({
      id: c.id,
      round: c.round,
      scheduledAt: c.scheduled_at,
      status: c.status,
      sides: (sidesByContest.get(c.id as string) ?? []).map(s => ({
        ...s,
        teamName: s.teamId ? (teamNames.get(s.teamId) ?? 'Team') : null,
      })),
    })),
    rosterByTeam: Object.fromEntries(
      visibleTeamIds.map(teamId => [
        teamId,
        [...(roster.get(teamId) ?? [])]
          .map(profileId => ({ profileId, displayName: names.get(profileId) ?? 'Athlete' }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      ])
    ),
    lines,
    linesAvailable,
  });
}

/** Batch stat-line upsert for one contest. Every line passes the roster
 *  gate for the exact team it is recorded against; provenance is stamped
 *  by resolved authority; club staff cannot overwrite a league-verified
 *  line (409). */
export async function statLinesUpsertPOST(
  admin: Admin,
  input: StatLinesUpsertInput,
  scope: CompetitionScope | null,
  enteredBy: string,
  /** Phase 6c I2: the CSV importer stamps 'imported' (owner authority
   *  only — the gate below still runs; only the label changes). */
  opts: { provenance?: 'imported' } = {}
): Promise<NextResponse> {
  const { data: contestRow } = await admin
    .from('contests')
    .select(
      'id, status, competition:competition_id (id, name, sport_key, format, status, league_id, club_id)'
    )
    .eq('id', input.contestId)
    .maybeSingle();
  const compRaw = contestRow?.competition;
  const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as CompRow | null | undefined;
  if (!contestRow || !comp) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }
  const access = await resolveCompetitionAccess(admin, comp, scope);
  if (!access) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  if (contestRow.status === 'canceled') {
    return NextResponse.json({ error: 'This game was canceled' }, { status: 400 });
  }
  if (comp.format !== 'fixture') {
    return NextResponse.json(
      { error: 'Player stats apply to team competitions' },
      { status: 400 }
    );
  }
  const schema = getStatSchema(comp.sport_key);
  if (!schema) {
    return NextResponse.json(
      { error: 'Player stats aren’t available for this sport' },
      { status: 400 }
    );
  }
  const knownKeys = new Map(schema.fields.map(f => [f.key, f]));
  for (const line of input.lines) {
    for (const [key, value] of Object.entries(line.stats)) {
      const field = knownKeys.get(key);
      if (!field) {
        return NextResponse.json(
          { error: `Unknown stat "${key}" for this sport` },
          { status: 400 }
        );
      }
      if (
        (field.min !== undefined && value < field.min) ||
        (field.max !== undefined && value > field.max)
      ) {
        return NextResponse.json(
          { error: `${field.label} is out of range` },
          { status: 400 }
        );
      }
    }
  }

  // Participating teams of THIS contest, narrowed by authority.
  const { data: participants } = await admin
    .from('contest_participants')
    .select('entry:entry_id (team_id)')
    .eq('contest_id', input.contestId);
  const contestTeamIds = new Set<string>();
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    if (entry?.team_id) contestTeamIds.add(entry.team_id as string);
  }
  const allowedTeamIds =
    access.authority === 'owner'
      ? contestTeamIds
      : new Set([...contestTeamIds].filter(id => access.clubTeamIds.has(id)));

  const roster = await rosterByTeam(admin, [...allowedTeamIds]);
  for (const line of input.lines) {
    if (!line.teamId || !allowedTeamIds.has(line.teamId)) {
      return NextResponse.json(
        { error: 'Each stat line must name a participating team you manage' },
        { status: 400 }
      );
    }
    if (!roster.get(line.teamId)?.has(line.profileId)) {
      // The invariant-3 gate: active team roster or nothing.
      return NextResponse.json(
        { error: 'A stat line references an athlete who is not on that team’s roster' },
        { status: 400 }
      );
    }
  }

  const provenance =
    opts.provenance === 'imported' && access.authority === 'owner'
      ? 'imported'
      : stampProvenance(access.authority);
  if (access.authority === 'participant') {
    // No silent downgrade: never overwrite the owner's verified rows.
    const { data: existing, error } = await admin
      .from('contest_stat_lines')
      .select('profile_id, provenance')
      .eq('contest_id', input.contestId)
      .in('profile_id', input.lines.map(l => l.profileId));
    if (error && isMissingTableError(error.code)) {
      return NextResponse.json(
        { error: 'Player stats aren’t set up yet — ask your admin (migration 157)' },
        { status: 400 }
      );
    }
    for (const row of existing ?? []) {
      if (!canOverwriteProvenance(row.provenance as ResultProvenance, 'participant')) {
        return NextResponse.json(
          { error: 'League-verified stats can only be changed by the competition owner' },
          { status: 409 }
        );
      }
    }
  }

  const { error } = await admin.from('contest_stat_lines').upsert(
    input.lines.map(line => ({
      contest_id: input.contestId,
      team_id: line.teamId,
      profile_id: line.profileId,
      stats: line.stats,
      provenance,
      entered_by: enteredBy,
    })),
    { onConflict: 'contest_id,profile_id' }
  );
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json(
        { error: 'Player stats aren’t set up yet — ask your admin (migration 157)' },
        { status: 400 }
      );
    }
    console.error(`${TAG} upsert error:`, error);
    return NextResponse.json({ error: 'Failed to save player stats' }, { status: 500 });
  }
  await revalidateOrgSiteForCompetition(admin, comp.id);
  return NextResponse.json({ ok: true, provenance });
}

/** Delete one stat line. Participants may delete only their own club's
 *  overwritable rows (same rule as upsert). */
export async function statLineDELETE(
  admin: Admin,
  lineId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const { data: line, error: readError } = await admin
    .from('contest_stat_lines')
    .select('id, team_id, provenance, contest:contest_id (competition:competition_id (id, name, sport_key, format, status, league_id, club_id))')
    .eq('id', lineId)
    .maybeSingle();
  if (readError && isMissingTableError(readError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const contestRaw = line?.contest;
  const contest = Array.isArray(contestRaw) ? contestRaw[0] : contestRaw;
  const compRaw = contest?.competition;
  const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as CompRow | null | undefined;
  if (!line || !comp) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, comp, scope);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.authority === 'participant') {
    if (
      !line.team_id ||
      !access.clubTeamIds.has(line.team_id as string) ||
      !canOverwriteProvenance(line.provenance as ResultProvenance, 'participant')
    ) {
      return NextResponse.json(
        { error: 'League-verified stats can only be changed by the competition owner' },
        { status: 409 }
      );
    }
  }
  const { error } = await admin.from('contest_stat_lines').delete().eq('id', lineId);
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the stat line' }, { status: 500 });
  }
  await revalidateOrgSiteForCompetition(admin, comp.id);
  return NextResponse.json({ success: true });
}

/** Competitions a club's teams are entered in but the club does not own —
 *  the participant console's doorway (Tom's R1 call: team staff enter
 *  stats). Approved entries only; degrades to empty pre-151. */
export async function externalCompetitionsGET(
  admin: Admin,
  clubId: string
): Promise<NextResponse> {
  const { data: teams } = await admin
    .from('teams')
    .select('id')
    .eq('club_id', clubId)
    .limit(200);
  const teamIds = (teams ?? []).map(t => t.id as string);
  if (teamIds.length === 0) return NextResponse.json({ competitions: [] });

  const { data: entries, error } = await admin
    .from('competition_entries')
    .select('competition_id')
    .in('team_id', teamIds)
    .eq('status', 'approved')
    .limit(500);
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ competitions: [] });
    console.error(`${TAG} external entries error:`, error);
    return NextResponse.json({ error: 'Failed to load competitions' }, { status: 500 });
  }
  const compIds = [...new Set((entries ?? []).map(e => e.competition_id as string))];
  if (compIds.length === 0) return NextResponse.json({ competitions: [] });

  const { data: comps } = await admin
    .from('competitions')
    .select('id, name, sport_key, format, status, league_id, club_id')
    .in('id', compIds)
    .limit(200);
  const external = ((comps ?? []) as CompRow[]).filter(c => c.club_id !== clubId);
  const leagueIds = [...new Set(external.map(c => c.league_id).filter((v): v is string => !!v))];
  const clubIds = [...new Set(external.map(c => c.club_id).filter((v): v is string => !!v))];
  const [leagueRows, clubRows] = await Promise.all([
    leagueIds.length
      ? admin.from('leagues').select('id, name').in('id', leagueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    clubIds.length
      ? admin.from('clubs').select('id, name').in('id', clubIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const leagueNames = new Map((leagueRows.data ?? []).map(r => [r.id as string, r.name as string]));
  const clubNames = new Map((clubRows.data ?? []).map(r => [r.id as string, r.name as string]));

  return NextResponse.json({
    competitions: external
      .map(c => ({
        id: c.id,
        name: c.name,
        sportKey: c.sport_key,
        format: c.format,
        status: c.status,
        owner: c.league_id
          ? { side: 'league', id: c.league_id, name: leagueNames.get(c.league_id) ?? 'League' }
          : { side: 'club', id: c.club_id!, name: clubNames.get(c.club_id!) ?? 'Club' },
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
