import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Stats hub at phone width (Web & Mobile Ship Together): the layered
 * performance hub must be REACHABLE at 390×844 — the ?tab=stats&sport=
 * deep link on the public route (anonymous, where the CDN-cached aggregate
 * feeds the chips), and the Overview strip-tap path into a sport layer.
 *
 * Shared-QA-user hygiene: seeds public visibility, a handle, rated rounds
 * and hockey settings; afterAll restores private/null and deletes the
 * seeded rows so later specs meet the state they pin.
 */

const user = () => loadQaUser('user.json');
const probeHandle = () => `hubqa${user().id.replace(/-/g, '').slice(0, 10)}`;

test.beforeAll(async () => {
  const admin = adminClient();
  const u = user();
  await admin.from('profiles').update({ visibility: 'public', handle: probeHandle() }).eq('id', u.id);
  const { data: existing } = await admin
    .from('golf_rounds').select('id').eq('profile_id', u.id).like('course', 'Hub QA%');
  if ((existing?.length ?? 0) === 0) {
    await admin.from('golf_rounds').insert([
      { profile_id: u.id, date: '2026-08-01', course: 'Hub QA National', holes: 18, par: 72, gross_score: 92, course_rating: 71.4, slope_rating: 128 },
      { profile_id: u.id, date: '2026-08-08', course: 'Hub QA National', holes: 18, par: 72, gross_score: 88, course_rating: 71.4, slope_rating: 128 },
      { profile_id: u.id, date: '2026-08-15', course: 'Hub QA Links', holes: 18, par: 71, gross_score: 95, course_rating: 70.2, slope_rating: 122 },
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
  await admin.from('golf_rounds').delete().eq('profile_id', u.id).like('course', 'Hub QA%');
  await admin.from('sport_settings').delete().eq('profile_id', u.id).eq('sport_key', 'ice_hockey');
  await admin.from('profiles').update({ visibility: 'private', handle: null }).eq('id', u.id);
});

test('@mobile anonymous /u/ deep link lands on the golf hub layer', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(`/u/@${probeHandle()}?tab=stats&sport=golf`);

  const tablist = page.getByRole('tablist', { name: 'Sport' });
  await expect(tablist.getByRole('tab', { name: 'Golf' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const header = page.getByRole('region', { name: 'Golf stats' });
  await expect(header.getByText('Handicap est.')).toBeVisible();
  // The full breakdown opens for an anonymous viewer too (the trends
  // endpoint's anonymous-public gate).
  await header.getByRole('button', { name: 'Full breakdown' }).click();
  await expect(header.getByText('Avg to par · last 5')).toBeVisible({ timeout: 15_000 });
  await context.close();
});

test('@mobile /u/ Overview strip-tap opens the Stats section on that sport', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(`/u/@${probeHandle()}`);

  const sports = page.locator('#sports');
  await sports.scrollIntoViewIfNeeded();
  await sports.getByRole('button', { name: 'Ice Hockey stats' }).click();

  const header = page.getByRole('region', { name: 'Ice Hockey stats' });
  await expect(header.getByText('AAA', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toContain('tab=stats&sport=ice_hockey');
  await context.close();
});
