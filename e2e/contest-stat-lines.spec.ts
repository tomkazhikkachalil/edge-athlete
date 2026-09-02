import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Contest stat lines (phase 4, round 1): per-athlete stats on a fixture
// contest. The league owner enters a line for a rostered athlete
// ('league_verified'); an off-roster athlete is rejected (§8 invariant 3 —
// follow is never a pipe); a participating club's manager enters a line
// for their OWN player through the club twin ('club_recorded') but cannot
// overwrite the owner's verified line (409); the owner console renders
// the Player stats panel at 375px.
test('contest stat lines: roster gate, provenance stamps, participant path; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const clubManager = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('contest_stat_lines').select('id').limit(1);
  test.skip(
    !!probe.error,
    `contest_stat_lines missing — run migration 157 (${probe.error?.message})`
  );

  const stamp = Date.now();
  const name = `QA StatLine League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA StatLine Club ${stamp}`, owner_profile_id: clubManager.id })
    .select()
    .single();
  const clubId = club!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { club_id: clubId, profile_id: clubManager.id, role: 'owner' },
    ]);
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    const { data: homeTeam } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();
    const { data: awayTeam } = await admin
      .from('teams')
      .insert({ club_id: clubId, name: `Comets ${stamp}` })
      .select()
      .single();
    const homeTeamId = homeTeam!.id as string;
    const awayTeamId = awayTeam!.id as string;

    // Roster edges: the owner plays for the league's team, the club
    // manager for the club's team (kind='roster' — THE attribution edge).
    await admin.from('memberships').insert([
      {
        league_id: leagueId,
        profile_id: owner.id,
        kind: 'roster',
        status: 'active',
        scope_type: 'team',
        scope_id: homeTeamId,
      },
      {
        club_id: clubId,
        profile_id: clubManager.id,
        kind: 'roster',
        status: 'active',
        scope_type: 'team',
        scope_id: awayTeamId,
      },
    ]);

    const { data: comp } = await admin
      .from('competitions')
      .insert({
        league_id: leagueId,
        season_id: season!.id,
        sport_key: 'ice_hockey',
        name: `House League ${stamp}`,
        format: 'fixture',
        entrant_type: 'team',
        status: 'active',
        visibility: 'private',
      })
      .select()
      .single();
    const compId = comp!.id as string;
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([
        { competition_id: compId, team_id: homeTeamId, status: 'approved' },
        { competition_id: compId, team_id: awayTeamId, status: 'approved' },
      ])
      .select();
    const homeEntry = entries!.find(e => e.team_id === homeTeamId)!;
    const awayEntry = entries!.find(e => e.team_id === awayTeamId)!;
    const { data: contest } = await admin
      .from('contests')
      .insert({ competition_id: compId, status: 'scheduled' })
      .select()
      .single();
    const contestId = contest!.id as string;
    await admin.from('contest_participants').insert([
      { contest_id: contestId, entry_id: homeEntry.id, side: 'home' },
      { contest_id: contestId, entry_id: awayEntry.id, side: 'away' },
    ]);

    const leagueBase = `/api/leagues/${leagueId}/competitions/${compId}/stat-lines`;
    const clubBase = `/api/clubs/${clubId}/competitions/${compId}/stat-lines`;

    const ownerApi = await apiAs('state-b.json');
    const clubApi = await apiAs('state.json');
    try {
      // Owner enters a line for a rostered athlete → league_verified.
      let res = await ownerApi.post(leagueBase, {
        data: {
          contestId,
          lines: [{ profileId: owner.id, teamId: homeTeamId, stats: { goals: 2, assists: 1 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).provenance).toBe('league_verified');

      // Off-roster athlete on that team → 400 (the invariant-3 gate).
      res = await ownerApi.post(leagueBase, {
        data: {
          contestId,
          lines: [{ profileId: clubManager.id, teamId: homeTeamId, stats: { goals: 1 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);

      // Unknown stat key for the sport → 400.
      res = await ownerApi.post(leagueBase, {
        data: {
          contestId,
          lines: [{ profileId: owner.id, teamId: homeTeamId, stats: { birdies: 3 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);

      // Participating club's manager enters their OWN player → club_recorded.
      res = await clubApi.post(clubBase, {
        data: {
          contestId,
          lines: [{ profileId: clubManager.id, teamId: awayTeamId, stats: { goals: 1, shots: 4 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      expect((await res.json()).provenance).toBe('club_recorded');

      // The participant aggregate shows ONLY the club's team + lines.
      res = await clubApi.get(clubBase);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const agg = await res.json();
      expect(agg.competition.access).toBe('participant');
      expect(Object.keys(agg.rosterByTeam)).toEqual([awayTeamId]);
      expect(agg.lines).toHaveLength(1);

      // The club cannot touch the league's team...
      res = await clubApi.post(clubBase, {
        data: {
          contestId,
          lines: [{ profileId: owner.id, teamId: homeTeamId, stats: { goals: 9 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);

      // ...nor overwrite an owner-verified line on its own player.
      const upgraded = await ownerApi.post(leagueBase, {
        data: {
          contestId,
          lines: [{ profileId: clubManager.id, teamId: awayTeamId, stats: { goals: 1 } }],
        },
      });
      expect(upgraded.status(), await readErrorBody(upgraded)).toBe(200);
      res = await clubApi.post(clubBase, {
        data: {
          contestId,
          lines: [{ profileId: clubManager.id, teamId: awayTeamId, stats: { goals: 5 } }],
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(409);

      // DB truth: two lines, the club player's row now league_verified.
      const { data: rows } = await admin
        .from('contest_stat_lines')
        .select('profile_id, team_id, provenance, stats')
        .eq('contest_id', contestId);
      expect(rows).toHaveLength(2);
      const clubRow = rows!.find(r => r.profile_id === clubManager.id)!;
      expect(clubRow.provenance).toBe('league_verified');
      expect(clubRow.team_id).toBe(awayTeamId);

      // ── R2: the profile read side ────────────────────────────────────
      // A PRIVATE competition's lines stay off the profile...
      const statLinesUrl = `/api/sports/stat-lines?profileId=${owner.id}&sport=ice_hockey`;
      let profileRes = await ownerApi.get(statLinesUrl);
      expect(profileRes.status(), await readErrorBody(profileRes)).toBe(200);
      expect((await profileRes.json()).official).toHaveLength(0);

      // ...and surface with their provenance the moment it flips public.
      await admin.from('competitions').update({ visibility: 'public' }).eq('id', compId);
      profileRes = await ownerApi.get(statLinesUrl);
      expect(profileRes.status(), await readErrorBody(profileRes)).toBe(200);
      const profileBody = await profileRes.json();
      expect(profileBody.official).toHaveLength(1);
      expect(profileBody.official[0]).toMatchObject({
        competitionName: `House League ${stamp}`,
        provenance: 'league_verified',
        href: `/league/${leagueId}/standings`,
      });

      // The skill card carries the official tiles (verified beats tracked).
      const cardsRes = await ownerApi.get(`/api/profile/${owner.id}/skill-cards`);
      expect(cardsRes.status(), await readErrorBody(cardsRes)).toBe(200);
      const cards = (await cardsRes.json()).skillCards as {
        sportKey: string;
        tiles: { label: string; value: string; provenance: string }[];
      }[];
      const hockey = cards.find(c => c.sportKey === 'ice_hockey');
      expect(hockey, 'hockey skill card exists').toBeTruthy();
      const goalsTile = hockey!.tiles.find(t => t.label === 'Goals');
      expect(goalsTile).toMatchObject({ value: '2', provenance: 'league_verified' });
    } finally {
      await ownerApi.dispose();
      await clubApi.dispose();
    }

    // Owner console: the Player stats panel renders and holds at 375px.
    const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxOwner.newPage();
      await page.goto(`/app/org/league/${leagueId}/competitions/${compId}`);
      await expect(
        page.getByRole('heading', { name: `House League ${stamp}` })
      ).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Player stats', exact: true }).click();
      // The bare team name also lives in the create-form <option>s —
      // assert the panel's own save button instead (strict mode).
      await expect(
        page.getByRole('button', { name: `Save Blazers ${stamp} stats` })
      ).toBeVisible({ timeout: 15_000 });
      // The owner's saved line prefills with its provenance label.
      await expect(page.getByText('League verified').first()).toBeVisible();

      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText('League verified').first()).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxOwner.close();
    }

    // Participant console: the club manager reaches the stat-entry view.
    const ctxClub = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctxClub.newPage();
      await page.goto(`/app/org/club/${clubId}/competitions/${compId}`);
      await expect(
        page.getByRole('heading', { name: `House League ${stamp}` })
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('recorded as club stats', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Player stats', exact: true }).click();
      await expect(
        page.getByRole('button', { name: `Save Comets ${stamp} stats` })
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctxClub.close();
    }
  } finally {
    // League delete cascades season → competition → contests → lines;
    // club delete cascades its memberships and team.
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
