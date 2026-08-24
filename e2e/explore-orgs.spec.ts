import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Org discovery on Explore (connections PR B): a seeded league and club are
// findable from the section's own search box, and rows navigate to the org
// pages. Modeled on explore-course-search.spec.ts's scoped-locator lesson:
// everything is scoped to the section's aria region.
test('explore orgs: search finds seeded league and club, rows navigate', async ({ page }) => {
  test.setTimeout(120_000);
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('leagues').select('id').limit(1);
  test.skip(!!probe.error, `leagues missing — run migration 113 (${probe.error?.message})`);

  const stamp = Date.now();
  const leagueName = `QA Explore League ${stamp}`;
  const clubName = `QA Explore Club ${stamp}`;

  const { data: league, error: leagueError } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: userB.id })
    .select()
    .single();
  expect(leagueError, leagueError?.message).toBeNull();
  const { data: club, error: clubError } = await admin
    .from('clubs')
    .insert({ name: clubName, owner_profile_id: userB.id })
    .select()
    .single();
  expect(clubError, clubError?.message).toBeNull();

  try {
    await page.goto('/explore');
    const section = page.getByRole('region', { name: 'Leagues & Clubs' });
    await expect(section).toBeVisible({ timeout: 15_000 });

    // The unique stamp matches both seeded orgs at once.
    await section.getByPlaceholder('Search leagues and clubs…').fill(String(stamp));
    await expect(section.getByText(leagueName)).toBeVisible({ timeout: 15_000 });
    await expect(section.getByText(clubName)).toBeVisible();

    // League row navigates to its page.
    await section.getByText(leagueName).click();
    await expect(page.getByRole('heading', { name: leagueName })).toBeVisible({ timeout: 15_000 });
  } finally {
    await admin.from('leagues').delete().eq('id', league!.id);
    await admin.from('clubs').delete().eq('id', club!.id);
  }
});
