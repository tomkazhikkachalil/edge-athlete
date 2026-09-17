import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Competition formats (track 2), PR 4 — the bracket's surfaces at phone
 * width on Chromium and WebKit. NEEDS MIGRATION 218 ON THE TARGET
 * (self-skips before). The owner's console: the seeding panel saves the
 * order, Preview reports the field, Generate draws the columns; a tied
 * semifinal asks who advances and how, the final fills by slot; the
 * contest place prints the round and the decision; the org's public
 * standings draw the bracket.
 */
test('bracket surfaces: seeds → preview → generate → a tied match decided → the contest place → the public bracket @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  // The mobile projects' default session is user A (`user.json`) — the console needs the OWNER's session, so A owns the league.
  const owner = loadQaUser('user.json');
  const admin = adminClient();
  const probe = await admin.from('contests').select('stage').limit(1);
  test.skip(!!probe.error, 'contests.stage missing — run migration 218');
  const stamp = Date.now();
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA Bracket Page ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const { data: teams } = await admin.from('teams').insert(Array.from({ length: 4 }, (_, i) => ({ league_id: leagueId, name: `Seed ${i + 1} ${stamp}` }))).select('id, name');
    const sorted = (teams ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const { data: comp } = await admin.from('competitions').insert({ league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: 'Playoffs', format: 'bracket', entrant_type: 'team', status: 'active', visibility: 'public' }).select().single();
    const competitionId = comp!.id as string;
    await admin.from('competition_entries').insert(sorted.map(t => ({ competition_id: competitionId, team_id: t.id })));

    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
    await expect(page.getByRole('heading', { name: 'Playoffs' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-bracket-seeds]')).toBeVisible();
    await page.locator('[data-bracket-save-seeds]').click();
    await expect(page.getByText('Seeds saved')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-bracket-preview]').click();
    await expect(page.locator('[data-bracket-report]')).toContainText('a field of 4 over 2 rounds', { timeout: 15_000 });
    await page.locator('[data-bracket-generate]').click();
    await expect(page.locator('[data-bracket-view]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-bracket-column]')).toHaveCount(2);
    await expect(page.locator('[data-bracket-slot="1:1"]')).toContainText(`Seed 1 ${stamp}`);
    await expect(page.locator('[data-bracket-slot="1:1"]')).toContainText(`Seed 4 ${stamp}`);
    await expect(page.locator('[data-bracket-slot="2:1"]')).toContainText('TBD');

    // A tied semifinal: who advances, and how.
    const semi = page.locator('li', { hasText: `Seed 1 ${stamp} vs Seed 4 ${stamp}` }).first();
    await semi.getByRole('button', { name: 'Enter score' }).click();
    await semi.getByLabel(`Score for Seed 1 ${stamp}`).fill('2');
    await semi.getByLabel(`Score for Seed 4 ${stamp}`).fill('2');
    await semi.getByLabel('Advances').selectOption({ label: `Seed 4 ${stamp}` });
    await semi.getByLabel('Advance by').selectOption('shootout');
    await semi.getByRole('button', { name: 'Save result' }).click();
    await expect(page.getByText('Result saved')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-bracket-slot="2:1"]')).toContainText(`Seed 4 ${stamp}`, { timeout: 20_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at phone width').toBeLessThanOrEqual(page.viewportSize()!.width);

    // The contest place: the round chip and the decision.
    const { data: semiRow } = await admin.from('contests').select('id').eq('competition_id', competitionId).eq('stage', 1).eq('slot', 1).single();
    await page.goto(`/event/${semiRow!.id}`);
    await expect(page.locator('[data-contest-outcome-line]')).toContainText('won on a shootout', { timeout: 20_000 });
    await expect(page.getByText('Semifinals', { exact: true }).first()).toBeVisible();

    // The public standings draw the bracket.
    await page.goto(`/league/${leagueId}/standings`);
    await expect(page.locator('[data-standings-bracket] [data-bracket-view]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-standings-bracket] [data-bracket-column]')).toHaveCount(2);
    await expect(page.locator('[data-standings-bracket] [data-bracket-slot="1:1"]')).toContainText('2–2');
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
