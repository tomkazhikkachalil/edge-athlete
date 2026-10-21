import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { liveWire } from './helpers/activities';

// Where people FIND activities. Since Oct 1 2026 that is INSIDE TRAINING, on
// BOTH profile routes (/u/ is where phone links land; route parity is mobile
// parity): the old `?tab=activities` deep link opens Training at its Activities
// section, an activity counts in the week / the active days / Recent
// sessions like a workout, a shared one is a training post, and the Training
// "Workouts" privacy aspect hides the listing from a viewer. Plus the feed
// card. Since Oct 13 2026 there is NO import door anywhere (the file import
// left with the Create menu's Import Activity). Tagged @mobile: 390 px
// Chromium AND WebKit.

// Twenty minutes ago (the fixture runs 15), less whole days: `0` is TODAY,
// so it lands in this week.
const wire = (daysAgo: number, name: string) => {
  const t0 = Date.now() - 20 * 60_000 - daysAgo * 86_400_000 - Math.floor(Math.random() * 120) * 1000;
  return liveWire({ t0, n: 900, stepM: 3, hr: 140, name });
};

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id').limit(1);
  test.skip(!!probe.error && (probe.error.code === '42P01' || probe.error.code === 'PGRST205'), 'migration 245 not applied on this target');
});

test('activities live inside Training on /u/ and /athlete; the feed card; no import door @mobile', async ({ browser }) => {
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
    for (const [d, n] of [[9, 'Ravine loop'], [0, 'Hill repeats']] as const) {
      const r = await api.post('/api/activities', { data: { activity: wire(d, n) } });
      expect(r.status(), await readErrorBody(r)).toBe(201);
      ids.push((await r.json()).id);
    }
    const shared = await api.post('/api/posts', { data: { postType: 'general', caption: 'Hills!', visibility: 'public', stats_data: { type: 'activity', activity_id: ids[1] } } });
    expect(shared.status(), await readErrorBody(shared)).toBeLessThan(300);
    const sharedJson = (await shared.json()) as { post?: { id?: string }; id?: string };
    const sharedPostId = (sharedJson.post?.id ?? sharedJson.id) as string;
    // A shared activity is a TRAINING post — it lists in Training like a shared workout.
    const { data: post } = await admin.from('posts').select('post_category').eq('profile_id', a.id).single();
    expect(post?.post_category).toBe('training');

    // A viewer on /u/ (where phone links land). The old deep link opens
    // TRAINING at its Activities section: both activities, no Import.
    const pageB = await ctxB.newPage();
    await pageB.goto(`/u/${handle}?tab=activities`);
    await expect(pageB.getByRole('heading', { name: 'Training', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(pageB.locator('[data-activity-item]')).toHaveCount(2, { timeout: 20_000 });
    await expect(pageB.locator('[data-activities-totals]')).toBeVisible();
    await expect(pageB.locator('[data-activities-import-link]')).toHaveCount(0);
    // There is no separate Activities tab any more.
    await expect(pageB.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Activities' })).toHaveCount(0);
    // The activities COUNT in Training: this athlete has no gym workout at all,
    // yet today's run is a session this week and an active day, and both
    // runs lead Recent sessions.
    await expect(pageB.getByText('Sessions this week')).toBeVisible();
    await expect(pageB.getByRole('img', { name: 'Active 1 of 7 days this week' })).toBeVisible();
    await expect(pageB.locator('[data-training-recent-sessions] [data-session-kind="activity"]')).toHaveCount(2);
    await expect(pageB.locator('[data-training-recent-sessions]')).toContainText('Hill repeats');
    // …and the shared one sits under Training Activity — as a tile (the Stats /
    // Media grid, Training fixes PR 2); a tap opens the post with its card.
    const grid = pageB.locator('[data-training-activity-grid]');
    await expect(grid).toBeVisible({ timeout: 20_000 });
    await expect(grid.locator(`[data-post-id="${sharedPostId}"]`)).toBeVisible();
    await grid.locator(`[data-post-id="${sharedPostId}"]`).click();
    await expect(pageB.locator('[data-post-detail]')).toBeVisible({ timeout: 20_000 });
    await expect(pageB.locator(`[data-post-detail] [data-activity-post-card="${ids[1]}"]`).first()).toBeVisible();
    await pageB.keyboard.press('Escape');
    await expect(pageB.locator('[data-post-detail]')).toHaveCount(0);
    // The same on /athlete/[id].
    await pageB.goto(`/athlete/${a.id}?tab=activities`);
    await expect(pageB.locator('[data-activity-item]')).toHaveCount(2, { timeout: 20_000 });
    await expect(pageB.locator('[data-training-recent-sessions] [data-session-kind="activity"]')).toHaveCount(2);

    // The feed card: the follower sees it, and it opens the activity.
    await pageB.goto('/feed');
    const card = pageB.locator(`[data-activity-post-card="${ids[1]}"]`).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Hill repeats');
    await card.click();
    await expect(pageB.locator('[data-activity-name]')).toHaveText('Hill repeats', { timeout: 20_000 });

    // The athlete hides Workouts in Training privacy: the LISTING goes for a
    // viewer (both forms of the read), the section with it — while the
    // activity they shared still opens from its post.
    await admin.from('profiles').update({ vitals_privacy: { hidden: false, body: false, records: false, workouts: true } }).eq('id', a.id);
    const viewerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: stateB, extraHTTPHeaders: bypassHeaders() });
    try {
      const sessions = await viewerApi.get(`/api/profile/${a.id}/activities?sessions=1`);
      expect(await sessions.json()).toEqual({ sessions: [], hidden: true });
      const page1 = await (await viewerApi.get(`/api/profile/${a.id}/activities`)).json();
      expect(page1).toMatchObject({ items: [], count: 0, hidden: true });
      expect((await viewerApi.get(`/api/activities/${ids[1]}`)).status()).toBe(200);
      // The owner still reads everything.
      expect(((await (await api.get(`/api/profile/${a.id}/activities?sessions=1`)).json()).sessions as unknown[]).length).toBe(2);
    } finally {
      await viewerApi.dispose();
    }
    await pageB.goto(`/u/${handle}?tab=training`);
    await expect(pageB.getByRole('heading', { name: 'Training', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(pageB.locator('[data-activities-tab]')).toHaveCount(0);
    await expect(pageB.locator('[data-training-recent-sessions]')).toHaveCount(0);
    await admin.from('profiles').update({ vitals_privacy: null }).eq('id', a.id);

    // The owner: Record in their own Training, and NO import door — not in
    // Training, not in the section, not in the Create sheet (Oct 13 2026).
    const pageA = await ctxA.newPage();
    await pageA.goto(`/athlete/${a.id}?tab=activities`);
    await expect(pageA.locator('[data-training-record-activity]')).toBeVisible({ timeout: 20_000 });
    await expect(pageA.locator('[data-training-import-activity]')).toHaveCount(0);
    await expect(pageA.locator('[data-activities-import-link]')).toHaveCount(0);
    await expect(pageA.getByText(/import/i)).toHaveCount(0);
    await pageA.goto('/sports/explore');
    await pageA.getByRole('button', { name: 'Create', exact: true }).first().click();
    await expect(pageA.locator('[data-create-sheet]')).toBeVisible();
    await expect(pageA.locator('[data-create-activity]')).toHaveCount(0);
    await expect(pageA.locator('[data-create-sheet]').getByText(/import/i)).toHaveCount(0);
  } finally {
    await Promise.all([api.dispose(), ctxA.close(), ctxB.close()]);
    for (const u of [a, b]) await deleteQaUser(u.id);
  }
});
