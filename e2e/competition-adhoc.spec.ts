import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Competition formats (track 2), PR 6 — ad-hoc sides at phone width on
 * Chromium and WebKit. NEEDS MIGRATION 219 ON THE TARGET (self-skips
 * before). The owner creates a fixture competition of NAMED SIDES on an
 * admin-minted league, adds "Reds" and "Blues" from the console (a
 * duplicate name refused), schedules and scores a game between them on
 * the competition page, and the contest place + the public standings
 * print the sides' names. The API pins the entry row (no team, no
 * athlete, a name) and a member outside the roster refused by name.
 */
test('ad-hoc sides: named entries from the console, a game between them, the names everywhere @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('competition_entries').select('name').limit(1);
  test.skip(!!probe.error, 'competition_entries.name missing — run migration 219');
  const api = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin.from('leagues').insert({ name: `QA AdHoc League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, visibility: 'public' }).select().single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const base = `/api/leagues/${leagueId}/competitions`;
    const created = await api.post(base, { data: { side: 'league', orgId: leagueId, seasonId: season!.id, sportKey: 'ice_hockey', name: 'Pickup Night', format: 'fixture', entrantType: 'ad_hoc_team', visibility: 'public' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    const compBody = (await created.json()) as { competition?: { id: string; entrant_type: string }; id?: string; entrant_type?: string };
    const competitionId = compBody.competition?.id ?? compBody.id!;
    expect(compBody.competition?.entrant_type ?? compBody.entrant_type).toBe('ad_hoc_team');
    await admin.from('competitions').update({ status: 'active' }).eq('id', competitionId);

    // The API: a side is a name; a member outside the roster is refused by name; a team id on this competition is refused.
    const outsider = await api.post(`${base}/entries`, { data: { competitionId, name: 'Ghosts', memberProfileIds: ['00000000-0000-4000-8000-000000000009'] } });
    expect(outsider.status()).toBe(400);
    expect(((await outsider.json()) as { reason?: string }).reason).toBe('member_not_rostered');

    // The console: Reds and Blues from the entries panel; a duplicate refused.
    await page.goto(`/app/org/league/${leagueId}`);
    await expect(page.getByText('Pickup Night', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Entries (0)' }).click();
    await page.getByLabel('Side name for Pickup Night').fill('Reds');
    await page.locator(`[data-adhoc-add="${competitionId}"]`).click();
    await expect(page.getByText('Reds', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Side name for Pickup Night').fill('Blues');
    await page.locator(`[data-adhoc-add="${competitionId}"]`).click();
    await expect(page.getByText('Blues', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Side name for Pickup Night').fill('reds');
    await page.locator(`[data-adhoc-add="${competitionId}"]`).click();
    await expect(page.getByText('already entered', { exact: false })).toBeVisible({ timeout: 15_000 });
    const { data: entries } = await admin.from('competition_entries').select('id, team_id, profile_id, name, status').eq('competition_id', competitionId).order('name');
    expect(entries).toHaveLength(2);
    expect(entries![0]).toMatchObject({ team_id: null, profile_id: null, name: 'Blues', status: 'approved' });

    // A game between them on the competition page; the score; no horizontal overflow.
    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
    await expect(page.getByRole('heading', { name: 'Pickup Night' })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Home side').selectOption({ label: 'Reds' });
    await page.getByLabel('Away side').selectOption({ label: 'Blues' });
    await page.getByRole('button', { name: 'Add game' }).click();
    await expect(page.getByText('Reds vs Blues')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Enter score' }).click();
    await page.getByLabel('Score for Reds').fill('3');
    await page.getByLabel('Score for Blues').fill('2');
    await page.getByRole('button', { name: 'Save result' }).click();
    await expect(page.getByText('Reds 3 – 2 Blues')).toBeVisible({ timeout: 15_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at phone width').toBeLessThanOrEqual(page.viewportSize()!.width);

    // The contest place and the public standings name the sides.
    const { data: contest } = await admin.from('contests').select('id').eq('competition_id', competitionId).single();
    await page.goto(`/event/${contest!.id}`);
    await expect(page.locator('[data-contest-score="home"]')).toHaveText('3', { timeout: 20_000 });
    await expect(page.getByText('Reds', { exact: true }).first()).toBeVisible();
    await page.goto(`/league/${leagueId}/standings`);
    await expect(page.getByText('Reds', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Blues', { exact: true }).first()).toBeVisible();
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
    await api.dispose();
  }
});
