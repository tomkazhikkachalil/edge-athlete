import { test, expect } from '@playwright/test';
import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { gpxOf, line } from '../src/lib/activities/__tests__/fixtures';

// Activities program PR 4 (Sep 29 2026): the athlete's path, at phone width
// (@mobile → the 390 px Chromium AND WebKit projects) and on desktop.
// Import a GPX and a FIT through the real file picker, open the activity,
// share it to the feed (the card is the server's), delete it (confirmed).

function fitBuffer(t0: number): Buffer {
  const encoder = new Encoder();
  const on = (num: number, m: Record<string, unknown>) => encoder.onMesg(num, m as Mesg);
  on(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: new Date(t0), type: 'activity' });
  const pts = line(900, { t0, stepM: 7, hr: 135 });
  pts.forEach((p, i) =>
    on(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.t),
      positionLat: Math.round(p.lat / (180 / 2 ** 31)),
      positionLong: Math.round(p.lng / (180 / 2 ** 31)),
      heartRate: p.hr,
      distance: i * 7,
    })
  );
  on(Profile.MesgNum.SESSION, { timestamp: new Date(pts[pts.length - 1].t), startTime: new Date(t0), sport: 'cycling' });
  return Buffer.from(encoder.close());
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('import a GPX and a FIT, open one, share it, delete it @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const u = await createQaUser({ displayName: 'Import Ivy', firstName: 'Import', lastName: 'Ivy' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  // A random past start (never the future — the server refuses an impossible date).
  const runStart = Date.UTC(2026, 7, 1, 12, 0, 0) + Math.floor(Math.random() * 1e6) * 1000;
  try {
    await page.goto('/activities/import');
    await page.setInputFiles('[data-activity-file-input]', [
      { name: 'morning.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxOf(line(1200, { t0: runStart, stepM: 3, hr: 150 }), { name: 'Lakeshore tempo' })) },
      { name: 'ride.fit', mimeType: 'application/octet-stream', buffer: fitBuffer(runStart + 3 * 86_400_000) },
    ]);
    await expect(page.locator('[data-import-row="imported"]')).toHaveCount(2, { timeout: 45_000 });

    // Picking the same file again says so and keeps one activity.
    await page.setInputFiles('[data-activity-file-input]', [
      { name: 'morning.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxOf(line(1200, { t0: runStart, stepM: 3, hr: 150 }), { name: 'Lakeshore tempo' })) },
    ]);
    await expect(page.locator('[data-import-row="updated"]')).toHaveCount(1, { timeout: 30_000 });
    const { data: rows } = await adminClient().from('activities').select('id, name, activity_type').eq('profile_id', u.id).order('started_at');
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({ name: 'Lakeshore tempo', activity_type: 'run' });
    expect(rows![1].activity_type).toBe('ride');

    // The activity page: the numbers, the map, the charts — reachable from the row.
    await page.locator('[data-import-row="updated"]').getByRole('link', { name: 'View' }).click();
    await expect(page.locator('[data-activity-name]')).toHaveText('Lakeshore tempo');
    await expect(page.locator('[data-activity-map]')).toBeVisible();
    await expect(page.locator('[data-activity-chart="hr"]')).toBeVisible();
    await expect(page.locator('[data-activity-splits]')).toBeVisible();

    // Share to feed: the post exists and carries the server's card.
    await page.locator('[data-activity-share]').click();
    await page.locator('[data-activity-share-panel] textarea').fill('Felt good');
    await page.locator('[data-activity-share-post]').click();
    await expect(page.getByText('On your feed')).toBeVisible({ timeout: 15_000 });
    const { data: post } = await adminClient().from('posts').select('id, caption, stats_data').eq('profile_id', u.id).single();
    expect(post!.caption).toBe('Felt good');
    expect(post!.stats_data).toMatchObject({ type: 'activity', activity_id: rows![0].id });

    // Delete, confirmed: the activity and its post go; the page lands on the profile tab.
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/tab=activities/, { timeout: 20_000 });
    expect((await adminClient().from('activities').select('id').eq('id', rows![0].id)).data).toHaveLength(0);
    expect((await adminClient().from('posts').select('id').eq('id', post!.id)).data).toHaveLength(0);
  } finally {
    await ctx.close();
    await deleteQaUser(u.id);
  }
});
