import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

/**
 * Users by location (migration 108). The QA user gets a picked place
 * (Ottawa, via the same columns the profile picker writes), then must be
 * findable by city, province and country in the header search, and by the
 * Location filter / Near me on Explore. Skips with a reason on a database
 * without 108 (no `place_id` column).
 */

const OTTAWA = { lat: 45.4215, lng: -75.6972 };

test.beforeAll(async () => {
  const admin = adminClient();
  const user = loadQaUser('user.json');
  const { data: place } = await admin.from('places').select('id').eq('name', 'Ottawa').eq('country_code', 'CA').maybeSingle();
  if (!place) test.skip(true, 'places not seeded (104)');
  const { error } = await admin
    .from('profiles')
    .update({
      visibility: 'public',
      place_id: place!.id,
      city: 'Ottawa',
      region: 'Ontario',
      region_code: 'ON',
      country: 'Canada',
      country_code: 'CA',
      lat: OTTAWA.lat,
      lng: OTTAWA.lng,
      location_source: 'user',
      location: 'Ottawa, Ontario · Canada',
    })
    .eq('id', user.id);
  if (error) test.skip(true, `profiles has no location columns yet (108): ${error.message}`);
});

test('people: found by city, province and country tokens; location shown on the row', async ({ page }) => {
  const user = loadQaUser('user.json');
  for (const q of ['ottawa', 'ontario', 'canada']) {
    const res = await page.request.get(`/api/search?q=${q}&type=athletes`);
    expect(res.ok()).toBe(true);
    const { results } = await res.json();
    const me = (results.athletes as { id: string; city?: string | null; country?: string | null }[]).find(a => a.id === user.id);
    expect(me, `'${q}' should find the QA profile`).toBeTruthy();
    expect(me!.city).toBe('Ottawa');
    expect(me!.country).toBe('Canada');
  }
});

test('people: a name beats a place — searching a city never outranks a person named after it', async ({ page }) => {
  const res = await page.request.get('/api/search?q=edge&type=athletes');
  const { results } = await res.json();
  // The QA user's first name is "Edge"; the name tier must place them first.
  expect((results.athletes as { first_name: string | null }[])[0]?.first_name).toBe('Edge');
});

test('people: the location filter alone (no text) is a filtered browse, distance-sorted', async ({ page }) => {
  const user = loadQaUser('user.json');
  const res = await page.request.get(`/api/search?type=athletes&near=${OTTAWA.lat},${OTTAWA.lng}&radius=50`);
  expect(res.ok()).toBe(true);
  const { results } = await res.json();
  const rows = results.athletes as { id: string; distance_km?: number | null }[];
  expect(rows.some(r => r.id === user.id)).toBe(true);
  const d = rows.map(r => r.distance_km ?? Infinity);
  expect(d).toEqual([...d].sort((a, b) => a - b));
});

test('explore: Near me lists the Ottawa QA athlete with a km chip', async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    geolocation: { latitude: OTTAWA.lat, longitude: OTTAWA.lng },
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  try {
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Near me' }).first().click();
    await expect(page.getByText('Edge QA').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Ottawa, Ontario · Canada • 0 km/).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});
