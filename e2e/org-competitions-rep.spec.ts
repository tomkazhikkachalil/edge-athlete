import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Cross-org rep entries (phase 2, round 4): a league owner enters an
// AFFILIATED club's team (member_of, active) → the entry lands PENDING +
// the pending bell reaches the other league manager; approving flips it
// approved + bells the club's managers; an UNAFFILIATED club's team gets
// the validation 400; DB truth throughout.
test('rep entries: affiliated pending → approve + bells; unaffiliated 400; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const clubOwner = loadQaUser('user.json'); // A: owns the club, manager of the league
  const leagueOwner = loadQaUser('user-b.json'); // B: owns the league
  const admin = adminClient();

  const probe = await admin.from('competition_standings').select('id').limit(1);
  test.skip(!!probe.error, `standings missing — run migrations 151–154 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Rep League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: leagueOwner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  const { data: club } = await admin
    .from('clubs')
    .insert({ name: `QA Rep Club ${stamp}`, owner_profile_id: clubOwner.id })
    .select()
    .single();
  const clubId = club!.id as string;
  const { data: strangerClub } = await admin
    .from('clubs')
    .insert({ name: `QA Stranger Club ${stamp}` })
    .select()
    .single();
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: leagueOwner.id, role: 'owner' },
    { league_id: leagueId, profile_id: clubOwner.id, role: 'manager' },
    { club_id: clubId, profile_id: clubOwner.id, role: 'owner' },
  ]);
  await admin.from('league_clubs').insert({
    league_id: leagueId,
    club_id: clubId,
    status: 'active',
    affiliation_type: 'member_of',
    initiated_by: 'league',
  });
  const { data: season } = await admin
    .from('seasons')
    .insert({ league_id: leagueId, label: '2026-27' })
    .select()
    .single();
  const { data: repTeam } = await admin
    .from('teams')
    .insert({ club_id: clubId, name: `Rep Blazers ${stamp}` })
    .select()
    .single();
  const { data: strangerTeam } = await admin
    .from('teams')
    .insert({ club_id: strangerClub!.id, name: `Strangers ${stamp}` })
    .select()
    .single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'ice_hockey',
      name: 'Rep Season',
      format: 'fixture',
      entrant_type: 'team',
      status: 'active',
      visibility: 'public',
    })
    .select()
    .single();
  const competitionId = comp!.id as string;

  try {
    // League owner drives the console: the affiliated team appears in the
    // optgroup; entering it lands PENDING.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Entries (0)' }).click();
      await page
        .getByLabel('Enter a team in Rep Season')
        .selectOption({ label: `Rep Blazers ${stamp} — QA Rep Club ${stamp}` });
      await expect(page.getByText('pending', { exact: true })).toBeVisible({ timeout: 15_000 });

      // 375px: chips + decide buttons stay usable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText('pending', { exact: true })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

      // Approve from the chip.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole('button', { name: `Approve Rep Blazers ${stamp}` }).click();
      await expect(page.getByText('pending', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await ctx.close();
    }

    // DB truth: approved entry + both notification types landed.
    const { data: entry } = await admin
      .from('competition_entries')
      .select('id, status, team_id')
      .eq('competition_id', competitionId)
      .single();
    expect(entry).toMatchObject({ status: 'approved', team_id: repTeam!.id });
    const { data: pendingBell } = await admin
      .from('notifications')
      .select('user_id, type')
      .eq('type', 'competition_entry_pending')
      .contains('metadata', { competition_id: competitionId });
    // The OTHER league manager (A) got it; the actor (B) was excluded.
    expect(pendingBell).toEqual([{ user_id: clubOwner.id, type: 'competition_entry_pending' }]);
    const { data: decidedBell } = await admin
      .from('notifications')
      .select('user_id, type, metadata')
      .eq('type', 'competition_entry_decided')
      .contains('metadata', { competition_id: competitionId });
    expect(decidedBell).toEqual([
      expect.objectContaining({ user_id: clubOwner.id, type: 'competition_entry_decided' }),
    ]);
    expect((decidedBell![0].metadata as { entry: string }).entry).toBe('approved');

    // The UNAFFILIATED club's team gets the validation 400.
    const ownerApi = await apiAs('state-b.json');
    try {
      const res = await ownerApi.post(`/api/leagues/${leagueId}/competitions/entries`, {
        data: { competitionId, teamId: strangerTeam!.id },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);
      expect(await res.text()).toContain('affiliated');
    } finally {
      await ownerApi.dispose();
    }
  } finally {
    await admin.from('notifications').delete().contains('metadata', { competition_id: competitionId });
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
    await admin.from('clubs').delete().eq('id', strangerClub!.id);
  }
});
