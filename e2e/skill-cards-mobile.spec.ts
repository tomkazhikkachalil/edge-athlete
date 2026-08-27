import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Skill cards at phone width (Web & Mobile Ship Together): the profile's
 * Sports section must be REACHABLE at 390×844 on both the public route
 * (/u/[handle], anonymous) and the athlete's own /athlete page — route
 * parity is the reason this section exists, so both routes are asserted.
 *
 * Shared-QA-user hygiene (see e2e order-dependence convention): this spec
 * MUTATES the shared user (public visibility, a handle, golf rounds, sport
 * settings) and RESTORES all of it in afterAll — visibility back to
 * private, handle cleared, seeded rows deleted — so later specs meet the
 * private-by-default state they pin.
 */

const user = () => loadQaUser('user.json');
const probeHandle = () => `skillqa${user().id.replace(/-/g, '').slice(0, 10)}`;

test.beforeAll(async () => {
  const admin = adminClient();
  const u = user();
  await admin.from('profiles').update({ visibility: 'public', handle: probeHandle() }).eq('id', u.id);
  // Guard on THIS spec's rounds, not any rounds: earlier suite specs leave
  // unrated rounds behind, and skipping our rated seed on their account left
  // no computable handicap in full-suite order (the Aug 2026 flake class).
  const { data: existing } = await admin
    .from('golf_rounds')
    .select('id')
    .eq('profile_id', u.id)
    .like('course', 'Skill QA%');
  if ((existing?.length ?? 0) === 0) {
    await admin.from('golf_rounds').insert([
      { profile_id: u.id, date: '2026-08-01', course: 'Skill QA National', holes: 18, par: 72, gross_score: 92, course_rating: 71.4, slope_rating: 128 },
      { profile_id: u.id, date: '2026-08-08', course: 'Skill QA National', holes: 18, par: 72, gross_score: 88, course_rating: 71.4, slope_rating: 128 },
      { profile_id: u.id, date: '2026-08-15', course: 'Skill QA Links', holes: 18, par: 71, gross_score: 95, course_rating: 70.2, slope_rating: 122 },
    ]);
  }
  await admin.from('sport_settings').upsert(
    [{ profile_id: u.id, sport_key: 'ice_hockey', settings: { competitive_level: 'aaa' } }],
    { onConflict: 'profile_id,sport_key' }
  );
});

test.afterAll(async () => {
  const admin = adminClient();
  const u = user();
  await admin.from('golf_rounds').delete().eq('profile_id', u.id).like('course', 'Skill QA%');
  await admin.from('sport_settings').delete().eq('profile_id', u.id).eq('sport_key', 'ice_hockey');
  await admin.from('profiles').update({ visibility: 'private', handle: null }).eq('id', u.id);
});

test('@mobile /u/ shows the sports skill cards to an anonymous phone viewer', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(`/u/@${probeHandle()}`);

  const sports = page.locator('#sports');
  await sports.scrollIntoViewIfNeeded();
  await expect(sports.getByText('Handicap est.')).toBeVisible({ timeout: 15_000 });
  await expect(sports.getByText('AAA', { exact: true })).toBeVisible();
  await context.close();
});

test('@mobile own /athlete page shows the section and the golf card opens trends', async ({ page }) => {
  await page.goto('/athlete');

  const sports = page.locator('#sports');
  await sports.scrollIntoViewIfNeeded();
  await expect(sports.getByText('Handicap est.')).toBeVisible({ timeout: 15_000 });

  // Owner interactivity: the golf card is a link into the trends page.
  await sports.getByText('Handicap est.').click();
  await page.waitForURL('**/app/sport/golf/trends', { timeout: 20_000 });
});
