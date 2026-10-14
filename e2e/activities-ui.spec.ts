import { test, expect } from '@playwright/test';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Activities program PR 4 (Sep 29 2026), re-seeded Oct 13 2026 when the file
// import left: the athlete's path, at phone width (@mobile → the 390 px
// Chromium AND WebKit projects) and on desktop. A saved recording's page —
// the numbers, the map, the charts — then share it to the feed (the card is
// the server's) and delete it (confirmed).

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('open a recording, share it, delete it @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const u = await createQaUser({ displayName: 'Record Ivy', firstName: 'Record', lastName: 'Ivy' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  // A random past start (never the future — the server refuses an impossible date).
  const runStart = Date.UTC(2026, 7, 1, 12, 0, 0) + Math.floor(Math.random() * 1e6) * 1000;
  try {
    const saved = await page.request.post('/api/activities', { data: { activity: liveWire({ t0: runStart, n: 1200, stepM: 3, hr: 150, name: 'Lakeshore tempo', type: 'run' }) } });
    expect(saved.status(), await saved.text()).toBe(201);
    const { id } = await saved.json();
    const { data: rows } = await adminClient().from('activities').select('id, name, activity_type, source').eq('profile_id', u.id);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ id, name: 'Lakeshore tempo', activity_type: 'run', source: 'live' });

    // The activity page: the numbers, the map, the charts.
    await page.goto(`/activities/${id}`);
    await expect(page.locator('[data-activity-name]')).toHaveText('Lakeshore tempo', { timeout: 20_000 });
    await expect(page.locator('[data-activity-map]')).toBeVisible();
    await expect(page.locator('[data-activity-chart="hr"]')).toBeVisible();
    await expect(page.locator('[data-activity-splits]')).toBeVisible();

    // Share to feed: the post exists and carries the server's card.
    await page.locator('[data-activity-share]').click();
    await page.locator('[data-activity-share-panel] textarea').fill('Felt good');
    // Who sees it is the account's call — said above Post, no per-post switch.
    await expect(page.locator('[data-activity-share-panel] [data-account-audience]')).toBeVisible();
    await page.locator('[data-activity-share-post]').click();
    await expect(page.getByText('On your feed')).toBeVisible({ timeout: 15_000 });
    const { data: post } = await adminClient().from('posts').select('id, caption, stats_data').eq('profile_id', u.id).single();
    expect(post!.caption).toBe('Felt good');
    expect(post!.stats_data).toMatchObject({ type: 'activity', activity_id: id });

    // Delete, confirmed: the activity and its post go; the page lands on the profile tab.
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/tab=activities/, { timeout: 20_000 });
    expect((await adminClient().from('activities').select('id').eq('id', id)).data).toHaveLength(0);
    expect((await adminClient().from('posts').select('id').eq('id', post!.id)).data).toHaveLength(0);
  } finally {
    await ctx.close();
    await deleteQaUser(u.id);
  }
});
