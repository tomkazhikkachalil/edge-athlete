import { test, expect } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Competition formats (track 2), PR 8 — the meet's surfaces at phone width
 * on Chromium and WebKit. NEEDS MIGRATIONS 218 + 219 ON THE TARGET
 * (self-skips before 219). The owner's console: the events panel adds the
 * 100m, the marks form places two athletes (A on Red, C on Blue), the row
 * prints the placed line and the team standings appear; the contest place
 * prints the marks; the org's public standings list the event's winner.
 */
test('meet surfaces: add an event → enter marks → the placed line and the team standings → the contest place → the public winners @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  // The mobile projects' default session is user A (`user.json`) — the console needs the OWNER's session, so A owns the league; B and C run.
  const owner = loadQaUser('user.json');
  const athleteA = loadQaUser('user-b.json');
  const athleteC = loadQaUser('user-c.json');
  const admin = adminClient();
  const probe = await admin.from('competition_entries').select('affiliation_team_id').limit(1);
  test.skip(!!probe.error, 'competition_entries.affiliation_team_id missing — run migration 219');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Meet Page ${stamp}`, sport_key: 'track_field', owner_profile_id: owner.id, visibility: 'public' });
  const leagueId = league.id;
  try {
    const { data: teams } = await admin.from('teams').insert([{ org_id: leagueId, name: `Red ${stamp}` }, { org_id: leagueId, name: `Blue ${stamp}` }]).select('id, name');
    const red = teams!.find(t => (t.name as string).startsWith('Red'))!.id as string;
    const blue = teams!.find(t => (t.name as string).startsWith('Blue'))!.id as string;
    const roster = (profileId: string, teamId: string) => [
      { org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'org', scope_id: null },
      { org_id: leagueId, profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: teamId },
    ];
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active', scope_type: 'org', scope_id: null }, ...roster(athleteA.id, red), ...roster(athleteC.id, blue)]);
    const { data: season } = await admin.from('seasons').insert({ org_id: leagueId, label: '2026' }).select().single();
    const { data: comp } = await admin.from('competitions').insert({ org_id: leagueId, season_id: season!.id, sport_key: 'track_field', name: 'Spring Meet', format: 'meet', entrant_type: 'athlete', status: 'active', visibility: 'public' }).select().single();
    const competitionId = comp!.id as string;
    const { data: entryRows } = await admin.from('competition_entries').insert([
      { competition_id: competitionId, profile_id: athleteA.id, status: 'approved', affiliation_team_id: red },
      { competition_id: competitionId, profile_id: athleteC.id, status: 'approved', affiliation_team_id: blue },
    ]).select('id, profile_id');
    const entryA = entryRows!.find(e => e.profile_id === athleteA.id)!.id as string;
    const entryC = entryRows!.find(e => e.profile_id === athleteC.id)!.id as string;

    // The console: add the 100m, enter the marks.
    await page.goto(`/app/org/league/${leagueId}/competitions/${competitionId}`);
    await expect(page.getByRole('heading', { name: 'Spring Meet' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-meet-panel]')).toBeVisible();
    await page.getByLabel('100m', { exact: true }).check();
    await page.locator('[data-meet-add]').click();
    await expect(page.getByText('Events added')).toBeVisible({ timeout: 15_000 });
    const row = page.locator('li', { hasText: '100m · 0 marks' }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator('[data-meet-enter]').click();
    await page.locator(`[data-meet-mark="${entryA}"]`).fill('11.85');
    await page.locator(`[data-meet-mark="${entryC}"]`).fill('12.10');
    await page.locator('[data-meet-save-marks]').click();
    await expect(page.getByText('Marks saved')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-meet-results]').first()).toContainText('11.85s', { timeout: 20_000 });
    await expect(page.locator('[data-meet-results]').first()).toContainText('2.');
    const standings = page.locator('section[aria-label="Standings"]');
    await expect(standings).toBeVisible({ timeout: 20_000 });
    await expect(standings.locator('tbody tr').first()).toContainText(`Red ${stamp}`);
    await expect(standings.locator('thead')).toContainText('Team');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at phone width').toBeLessThanOrEqual(page.viewportSize()!.width);

    // The contest place: the marks by the event's rule.
    const { data: contest } = await admin.from('contests').select('id').eq('competition_id', competitionId).eq('round', '100m').single();
    await page.goto(`/event/${contest!.id}`);
    await expect(page.locator('[data-contest-row]')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator('[data-contest-row]').first()).toContainText('11.85s');
    await expect(page.getByText('100m', { exact: true }).first()).toBeVisible();

    // The public standings: the event and its winner.
    await page.goto(`/league/${leagueId}/standings`);
    await expect(page.locator('[data-standings-meet]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-meet-event="100m"]')).toContainText('11.85s');
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
