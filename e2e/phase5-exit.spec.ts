import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The phase-5 exit condition, in one spec: "a season runs end to end from
// registration to standings." A family registers → the registrar places
// onto a team (minting the team-scope attribution edge) → that team is
// entered in a competition → a contest gets a result AND the placed
// athlete gets a stat line (the phase-4 tie-in: the roster gate accepts
// the placement row) → the standings materialize → the athlete's profile
// shows the official stat. No manual linking anywhere in the chain.
test('phase 5 exit: registration → placement → competition → standings → profile', async () => {
  test.setTimeout(240_000);
  const athlete = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('registrations').select('id').limit(1);
  test.skip(!!probe.error, `registrations missing — run migration 162 (${probe.error?.message})`);
  test.skip(
    process.env.NEXT_PUBLIC_FEATURE_ORG_REGISTRATION !== '1',
    'FEATURE_ORG_REGISTRATION off on this target'
  );

  const stamp = Date.now();
  const name = `QA Exit League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27', starts_on: '2026-09-01' })
      .select()
      .single();
    const seasonId = season!.id as string;
    const { data: division } = await admin
      .from('divisions')
      .insert({
        league_id: leagueId,
        season_id: seasonId,
        sport_key: 'ice_hockey',
        name: `U18 A ${stamp}`,
        age_band: 'U18',
      })
      .select()
      .single();
    const { data: teamA } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();
    const { data: teamB } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Comets ${stamp}` })
      .select()
      .single();

    const athleteApi = await apiAs('state.json');
    const ownerApi = await apiAs('state-b.json');
    try {
      // 1. The registrar opens registration; the family registers.
      let res = await ownerApi.post(`/api/leagues/${leagueId}/registration-windows`, {
        data: { seasonId, opensAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      res = await athleteApi.post(`/api/leagues/${leagueId}/registrations`, {
        data: { seasonId, divisionId: division!.id, answers: {} },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const registrationId = ((await res.json()).registration as { id: string }).id;

      // 2. Placement mints the attribution edge.
      res = await ownerApi.patch(
        `/api/leagues/${leagueId}/registrations/${registrationId}`,
        { data: { action: 'place', teamId: teamA!.id } }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // 3. The competition (entries/contest seeded the proven admin way —
      // the contest-stat-lines recipe; results ride the real API).
      const { data: comp } = await admin
        .from('competitions')
        .insert({
          league_id: leagueId,
          season_id: seasonId,
          sport_key: 'ice_hockey',
          name: `House League ${stamp}`,
          format: 'fixture',
          entrant_type: 'team',
          status: 'active',
          visibility: 'public',
        })
        .select()
        .single();
      const competitionId = comp!.id as string;
      const { data: entries } = await admin
        .from('competition_entries')
        .insert([
          { competition_id: competitionId, team_id: teamA!.id, status: 'approved' },
          { competition_id: competitionId, team_id: teamB!.id, status: 'approved' },
        ])
        .select();
      const { data: contest } = await admin
        .from('contests')
        .insert({ competition_id: competitionId, status: 'scheduled' })
        .select()
        .single();
      await admin.from('contest_participants').insert([
        {
          contest_id: contest!.id,
          entry_id: entries!.find(e => e.team_id === teamA!.id)!.id,
          side: 'home',
        },
        {
          contest_id: contest!.id,
          entry_id: entries!.find(e => e.team_id === teamB!.id)!.id,
          side: 'away',
        },
      ]);
      const { data: participants } = await admin
        .from('contest_participants')
        .select('id, side')
        .eq('contest_id', contest!.id);
      res = await ownerApi.post(
        `/api/leagues/${leagueId}/competitions/${competitionId}/results`,
        {
          data: {
            contestId: contest!.id,
            results: [
              {
                participantId: participants!.find(pt => pt.side === 'home')!.id,
                score: 4,
              },
              {
                participantId: participants!.find(pt => pt.side === 'away')!.id,
                score: 2,
              },
            ],
          },
        }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // 4. The phase-4 tie-in: a stat line for the PLACED athlete — the
      // roster gate accepts the placement-minted team row.
      res = await ownerApi.post(
        `/api/leagues/${leagueId}/competitions/${competitionId}/stat-lines`,
        {
          data: {
            contestId: contest!.id,
            lines: [{ profileId: athlete.id, teamId: teamA!.id, stats: { goals: 2 } }],
          },
        }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).provenance).toBe('league_verified');

      // 5. Standings materialized with both teams.
      const { data: standings } = await admin
        .from('competition_standings')
        .select('entry_id, rank, points')
        .eq('competition_id', competitionId)
        .order('rank', { ascending: true });
      expect(standings).toHaveLength(2);
      expect(standings![0].points).toBe(2); // the 2-1-0 hockey default: a win

      // 6. The athlete's profile shows the official stat with the ladder.
      res = await athleteApi.get(
        `/api/sports/stat-lines?profileId=${athlete.id}&sport=ice_hockey`
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const officialRows = ((await res.json()).official as Array<Record<string, unknown>>).filter(
        r => r.competitionName === `House League ${stamp}`
      );
      expect(officialRows).toHaveLength(1);
      expect(officialRows[0]).toMatchObject({
        provenance: 'league_verified',
        href: `/league/${leagueId}/standings`,
      });
    } finally {
      await athleteApi.dispose();
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
