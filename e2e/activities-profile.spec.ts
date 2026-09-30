import { test, expect, request as pwRequest } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { parseGpx } from '../src/lib/activities/parse-gpx';
import { toWire } from '../src/lib/activities/wire';
import { gpxOf, line } from '../src/lib/activities/__tests__/fixtures';

// Activities program PR 5 (Sep 29 2026): where people FIND activities —
// the Activities tab on BOTH profile routes (/u/ is where phone links land;
// route parity is mobile parity), the feed card, and the header's Create
// sheet. Tagged @mobile: 390 px Chromium AND WebKit.

const wire = (daysAgo: number, name: string) => {
  const t0 = Date.UTC(2026, 8, 1, 12) - daysAgo * 86_400_000 + Math.floor(Math.random() * 1e5) * 1000;
  return toWire({ ...parseGpx(gpxOf(line(900, { t0, stepM: 3, hr: 140 }), { name })), format: 'gpx' }, 'America/Toronto');
};

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('the tab on /u/ and /athlete, the feed card, the Create sheet @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const a = await createQaUser({ displayName: 'Trail Tess', firstName: 'Trail', lastName: 'Tess' });
  const b = await createQaUser({ displayName: 'Fan Finn', firstName: 'Fan', lastName: 'Finn' });
  const handle = `trailtess${Math.floor(Math.random() * 1e6)}`;
  await admin.from('profiles').update({ visibility: 'public', handle }).eq('id', a.id);
  await admin.from('follows').insert({ follower_id: b.id, following_id: a.id, status: 'accepted' });
  const stateA = await mintStorageState(a);
  const stateB = await mintStorageState(b);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: stateA, extraHTTPHeaders: bypassHeaders() });
  const ctxB = await browser.newContext({ storageState: stateB, extraHTTPHeaders: bypassHeaders() });
  const ctxA = await browser.newContext({ storageState: stateA, extraHTTPHeaders: bypassHeaders() });
  try {
    const ids: string[] = [];
    for (const [d, n] of [[3, 'Ravine loop'], [1, 'Hill repeats']] as const) {
      const r = await api.post('/api/activities', { data: { activity: wire(d, n) } });
      expect(r.status(), await readErrorBody(r)).toBe(201);
      ids.push((await r.json()).id);
    }
    const shared = await api.post('/api/posts', { data: { postType: 'general', caption: 'Hills!', visibility: 'public', stats_data: { type: 'activity', activity_id: ids[1] } } });
    expect(shared.status(), await readErrorBody(shared)).toBeLessThan(300);

    // A viewer on /u/ (where phone links land): the tab, both activities, no Import.
    const pageB = await ctxB.newPage();
    await pageB.goto(`/u/${handle}?tab=activities`);
    await expect(pageB.locator('[data-activity-item]')).toHaveCount(2, { timeout: 20_000 });
    await expect(pageB.locator('[data-activities-totals]')).toBeVisible();
    await expect(pageB.locator('[data-activities-import-link]')).toHaveCount(0);
    // …and the same on /athlete/[id].
    await pageB.goto(`/athlete/${a.id}?tab=activities`);
    await expect(pageB.locator('[data-activity-item]')).toHaveCount(2, { timeout: 20_000 });

    // The feed card: the follower sees it, and it opens the activity.
    await pageB.goto('/feed');
    const card = pageB.locator(`[data-activity-post-card="${ids[1]}"]`).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Hill repeats');
    await card.click();
    await expect(pageB.locator('[data-activity-name]')).toHaveText('Hill repeats', { timeout: 20_000 });

    // The owner: Import on their own tab, and the Create sheet's Activity door.
    const pageA = await ctxA.newPage();
    await pageA.goto(`/athlete/${a.id}?tab=activities`);
    await expect(pageA.locator('[data-activities-import-link]')).toBeVisible({ timeout: 20_000 });
    await pageA.goto('/sports/explore');
    await pageA.getByRole('button', { name: 'Create', exact: true }).first().click();
    await pageA.locator('[data-create-activity]').click();
    await expect(pageA).toHaveURL(/\/activities\/import/, { timeout: 15_000 });
    await expect(pageA.locator('[data-activity-import]')).toBeVisible();
  } finally {
    await Promise.all([api.dispose(), ctxA.close(), ctxB.close()]);
    for (const u of [a, b]) await deleteQaUser(u.id);
  }
});
