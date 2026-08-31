import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Competitions (phase 2, round 1): the owner creates a fixture competition
// from the console and enters two teams; a plain member gets 403 from the
// manager API; DB truth pins the derived entrant_type and the entry rows.
test('org console: owner creates a competition + entries; member locked out; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('competitions').select('id').limit(1);
  test.skip(!!probe.error, `competitions missing — run migration 151 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Comp League ${stamp}`;
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);
  const { data: season } = await admin
    .from('seasons')
    .insert({ league_id: leagueId, label: '2026-27' })
    .select()
    .single();
  const seasonId = season!.id as string;
  await admin.from('teams').insert([
    { league_id: leagueId, name: `Blazers ${stamp}` },
    { league_id: leagueId, name: `Comets ${stamp}` },
  ]);

  try {
    const ctxOwner = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ctxOwner.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });

      // Create the competition (fixture; public so R3's surfaces can show it).
      await page.getByLabel('Competition name').fill('House League');
      await page.getByLabel('Competition season').selectOption(seasonId);
      await page.getByLabel('Public competition').check();
      await page.getByRole('button', { name: 'Add competition' }).click();
      await expect(page.getByText('House League', { exact: true })).toBeVisible();

      // Enter both teams.
      await page.getByRole('button', { name: 'Entries (0)' }).click();
      const entrySelect = page.getByLabel('Enter a team in House League');
      await entrySelect.selectOption({ label: `Blazers ${stamp}` });
      await expect(
        page.getByText(`Blazers ${stamp}`, { exact: true }).nth(0)
      ).toBeVisible({ timeout: 15_000 });
      await entrySelect.selectOption({ label: `Comets ${stamp}` });
      await expect(page.getByText(`Comets ${stamp}`, { exact: true }).nth(0)).toBeVisible({
        timeout: 15_000,
      });

      // Activate.
      await page.getByRole('button', { name: 'Activate' }).click();
      await expect(page.getByRole('button', { name: 'Complete' })).toBeVisible({ timeout: 15_000 });

      // 375px: the section stays usable, no horizontal overflow.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText('House League', { exact: true })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxOwner.close();
    }

    // DB truth: derived entrant_type, org inherited, both entries approved.
    const { data: comp } = await admin
      .from('competitions')
      .select('id, league_id, format, entrant_type, status, visibility')
      .eq('season_id', seasonId)
      .single();
    expect(comp).toMatchObject({
      league_id: leagueId,
      format: 'fixture',
      entrant_type: 'team',
      status: 'active',
      visibility: 'public',
    });
    const { data: entries } = await admin
      .from('competition_entries')
      .select('status, team_id, profile_id')
      .eq('competition_id', comp!.id);
    expect(entries).toHaveLength(2);
    for (const e of entries!) {
      expect(e.status).toBe('approved');
      expect(e.team_id).not.toBeNull();
      expect(e.profile_id).toBeNull();
    }

    // Member: manager API 403s.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.get(`/api/leagues/${leagueId}/competitions`);
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await memberApi.dispose();
    }
  } finally {
    // League delete cascades seasons → competitions → entries and teams.
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
