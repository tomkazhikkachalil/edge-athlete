import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { purgeGolfRound, purgePost } from './helpers/results';
import { cardRowFor, readScorecard, scoreHoles } from './helpers/sport-events';

// ── Results-kept round PR 2 (241, Sep 26 2026): hide, never delete ──────────
// Tom: "I eventually want the information taken about the athlete to be
// incredibly accurate, at least on the backend. The user can have their
// profile viewed as they would like." Alpha "deletes" a stat line and a golf
// round: both leave what others see, both stay on the record (the dataset
// row, the round). Alpha shows them again from Settings → Privacy at phone
// width. A plain post still deletes. Test data is purged with the service
// role in `finally` (the app never deletes a result any more).

test('a result is hidden, never deleted: the record stays, others lose sight of it, the owner shows it again @mobile', async ({ browser }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('golf_rounds').select('profile_hidden_at').limit(1);
  test.skip(!!probe.error, `golf_rounds.profile_hidden_at missing — run migration 241 (${probe.error?.message})`);
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  await resetRateBucket(admin, 'post-create', alpha.id);
  await resetRateBucket(admin, 'result-visibility', alpha.id);
  const stamp = Date.now();
  let lineId = '';
  let plainId = '';
  let roundPostId = '';
  let roundId = '';
  try {
    // A self-entered stat line.
    let res = await alphaApi.post('/api/posts', {
      data: { caption: `Hide me ${stamp}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-20', opponent: 'Wolves', result: 'L', stats: { goals: 0, assists: 0 } } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    lineId = (await res.json()).post.id as string;
    // A solo golf round (its post only references the round).
    const holesData = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, score: 6 }));
    res = await alphaApi.post('/api/posts', { data: { caption: `Bad day ${stamp}`, visibility: 'public', postType: 'golf', golfData: { date: '2026-09-21', courseName: `QA Hide Links ${stamp}`, holes: '18', coursePar: 72, holesData } } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    roundPostId = (await res.json()).post.id as string;
    roundId = ((await admin.from('posts').select('round_id').eq('id', roundPostId).single()).data?.round_id as string) ?? '';
    expect(roundId).toBeTruthy();
    // A plain post.
    res = await alphaApi.post('/api/posts', { data: { caption: `Just a photo caption ${stamp}`, visibility: 'public', postType: 'general' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    plainId = (await res.json()).post.id as string;

    // "Delete" the stat line → hidden; the dataset row stays.
    res = await alphaApi.delete(`/api/posts?postId=${lineId}`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).hidden).toBe(true);
    expect((await admin.from('posts').select('status').eq('id', lineId).single()).data?.status).toBe('profile_hidden');
    await expect.poll(async () => (await admin.from('athlete_performances').select('id').eq('natural_key', `post:${lineId}`)).data?.length ?? 0).toBe(1);

    // "Delete" the round → hidden; the round and its dataset row stay; others lose sight of it.
    res = await alphaApi.delete(`/api/golf/rounds/${roundId}`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).hidden).toBe(true);
    expect((await admin.from('golf_rounds').select('profile_hidden_at').eq('id', roundId).single()).data?.profile_hidden_at).toBeTruthy();
    expect((await admin.from('athlete_performances').select('id').eq('natural_key', `golf_round:${roundId}`)).data).toHaveLength(1);
    // QA profiles are private — open alpha's for this check so the HIDE (not privacy) is what hides it.
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    try {
      const bravoRes = await bravoApi.get(`/api/golf/rounds?limit=50&profileId=${alpha.id}`);
      expect(bravoRes.status(), await readErrorBody(bravoRes)).toBe(200);
      const bravoList = (await bravoRes.json()) as { rounds: Array<{ id: string }> };
      expect(bravoList.rounds.map(r => r.id)).not.toContain(roundId);
      expect((await bravoApi.get(`/api/golf/rounds/${roundId}`)).status()).toBe(404);
    } finally {
      await admin.from('profiles').update({ visibility: 'private' }).eq('id', alpha.id);
    }
    const alphaList = (await (await alphaApi.get('/api/golf/rounds?limit=50')).json()) as { rounds: Array<{ id: string; profile_hidden_at: string | null }> };
    expect(alphaList.rounds.find(r => r.id === roundId)?.profile_hidden_at, 'the owner still sees it, marked').toBeTruthy();

    // A plain post still deletes.
    res = await alphaApi.delete(`/api/posts?postId=${plainId}`);
    expect(res.ok()).toBe(true);
    expect((await res.json()).hidden).toBeUndefined();
    expect((await admin.from('posts').select('id').eq('id', plainId)).data).toHaveLength(0);
    plainId = '';

    // The owner's list, and "Show again" at phone width.
    const list = (await (await alphaApi.get('/api/results/visibility')).json()) as { rounds: Array<{ id: string }>; posts: Array<{ id: string; course?: string | null }> };
    // One row per result (Oct 2026): hiding the round hid its post too, and
    // the pair is listed ONCE — as the post, carrying the course.
    expect((await admin.from('posts').select('status').eq('id', roundPostId).single()).data?.status).toBe('profile_hidden');
    expect(list.rounds.map(r => r.id)).not.toContain(roundId);
    expect(list.posts.find(p => p.id === roundPostId)?.course).toBe(`QA Hide Links ${stamp}`);
    expect(list.posts.map(p => p.id)).toContain(lineId);
    // Nobody else can flip it.
    expect((await bravoApi.patch('/api/results/visibility', { data: { kind: 'post', id: lineId, hidden: false } })).status()).toBe(404);

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto('/settings?tab=privacy');
      const section = page.locator('[data-hidden-results]');
      await expect(section).toBeVisible({ timeout: 20_000 });
      const showLine = section.locator(`[data-show-result="${lineId}"]`);
      await expect(showLine).toBeVisible();
      expect((await showLine.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await showLine.click();
      await expect(page.locator('[data-hidden-results-message]')).toHaveText(/Back on your profile/, { timeout: 15_000 });
      await expect(section.locator(`[data-hidden-post="${lineId}"]`)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
    expect((await admin.from('posts').select('status').eq('id', lineId).single()).data?.status).toBe('published');
  } finally {
    await purgePost(lineId);
    await purgePost(plainId);
    await purgePost(roundPostId);
    await purgeGolfRound(roundId);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
});

// ── Fix round (Oct 2026): a hide has to be SEEN to have happened ────────────
// Tom: "the hide function doesn't work… when you hide a post, it still
// appears on your athlete profile, but there is no way to unhide it." The
// server hid; the feed and the profile handed the post straight back to its
// owner, unmarked. A for-fun round is played and ended, then hidden from the
// FEED CARD: it leaves the owner's feed for good, stays on their own profile
// marked "Hidden", and "Show on profile" there brings it back. Hiding from
// the round page takes the post with it, and Settings lists the pair once.

async function hideSeenToHappen(browser: import('@playwright/test').Browser, viewport: { width: number; height: number }) {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const api = await apiAs('state.json');
  await resetRateBucket(admin, 'post-create', alpha.id);
  await resetRateBucket(admin, 'result-visibility', alpha.id);
  const stamp = Date.now();
  const course = `QA Seen Links ${stamp}`;
  let groupPostId = '';
  let postId = '';
  let mirrorId = '';
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport });
  try {
    // A for-fun round, alone: scored, then ended (the mirror and the post).
    let res = await api.post('/api/group-posts', {
      data: { type: 'golf_round', title: `QA Seen Round ${stamp}`, date: new Date().toISOString().split('T')[0], visibility: 'public', participant_ids: [], golf_data: { course_name: course, round_type: 'outdoor', holes_played: 9 } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    groupPostId = (await res.json()).group_post.id as string;
    const card = await readScorecard(api, groupPostId);
    await scoreHoles(api, cardRowFor(card, alpha.id), Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes: 5 })));
    res = await api.patch(`/api/group-posts/${groupPostId}`, { data: { status: 'completed' } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    postId = ((await admin.from('group_posts').select('post_id').eq('id', groupPostId).single()).data?.post_id as string) ?? '';
    expect(postId).toBeTruthy();
    await expect.poll(async () => (await admin.from('golf_rounds').select('id').eq('group_post_id', groupPostId).eq('profile_id', alpha.id)).data?.length ?? 0).toBe(1);
    mirrorId = (await admin.from('golf_rounds').select('id').eq('group_post_id', groupPostId).eq('profile_id', alpha.id).single()).data!.id as string;

    const inFeed = async () => {
      const feed = await api.get('/api/posts?limit=50');
      expect(feed.ok(), await readErrorBody(feed)).toBe(true);
      return ((await feed.json()).posts as Array<{ id: string }>).some(p => p.id === postId);
    };
    expect(await inFeed()).toBe(true);

    // Hide it from the feed card — the owner's own control at this width.
    const page = await ctx.newPage();
    await page.goto('/feed');
    const feedCard = page.locator('[data-testid="post-card"]').filter({ hasText: course }).first();
    await expect(feedCard).toBeVisible({ timeout: 20_000 });
    const menu = feedCard.getByRole('button', { name: 'Post options' });
    if (await menu.isVisible()) {
      await menu.click();
      await page.locator('[data-menu-item="delete"]').click();
    } else {
      await feedCard.locator('[data-post-delete="hide"]').click();
    }
    await expect(page.getByText('Hide from your profile?')).toBeVisible();
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(feedCard).toHaveCount(0, { timeout: 15_000 });

    // It STAYS gone: the feed no longer hands it back to its owner…
    expect((await admin.from('posts').select('status').eq('id', postId).single()).data?.status).toBe('profile_hidden');
    expect((await admin.from('golf_rounds').select('profile_hidden_at').eq('id', mirrorId).single()).data?.profile_hidden_at).toBeTruthy();
    expect(await inFeed()).toBe(false);
    const again = await ctx.newPage();
    await again.goto('/feed');
    await expect(again.locator('[data-testid="post-card"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(again.locator('[data-testid="post-card"]').filter({ hasText: course })).toHaveCount(0);
    await again.close();
    // …and Settings lists the result once (the post, carrying the course).
    const list = (await (await api.get('/api/results/visibility')).json()) as { rounds: Array<{ id: string }>; posts: Array<{ id: string; course?: string | null }> };
    expect(list.rounds.map(r => r.id)).not.toContain(mirrorId);
    expect(list.posts.find(p => p.id === postId)?.course).toBe(course);

    // On the owner's own profile it is still there — marked, with the way back.
    const profile = await ctx.newPage();
    await profile.goto('/athlete');
    const tile = profile.locator('button:has([data-tile-profile-hidden])').first();
    await expect(tile).toBeVisible({ timeout: 20_000 });
    await tile.click();
    const popup = profile.locator('[data-post-detail]');
    await expect(popup.locator('[data-post-profile-hidden]')).toBeVisible({ timeout: 20_000 });
    await expect(popup.locator('[data-post-delete="hide"]')).toHaveCount(0);
    await popup.locator('[data-post-show-again]').click();
    await expect(popup.locator('[data-post-profile-hidden]')).toHaveCount(0, { timeout: 15_000 });
    expect((await admin.from('posts').select('status').eq('id', postId).single()).data?.status).toBe('published');
    expect((await admin.from('golf_rounds').select('profile_hidden_at').eq('id', mirrorId).single()).data?.profile_hidden_at).toBeNull();
    expect(await inFeed()).toBe(true);

    // Hiding from the ROUND page takes the post with it (it stayed published).
    res = await api.delete(`/api/golf/rounds/${mirrorId}`);
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await admin.from('posts').select('status').eq('id', postId).single()).data?.status).toBe('profile_hidden');
    expect(await inFeed()).toBe(false);
  } finally {
    await ctx.close().catch(() => null);
    if (mirrorId) await purgeGolfRound(mirrorId);
    if (postId) await purgePost(postId);
    if (groupPostId) await admin.from('group_posts').delete().eq('id', groupPostId);
    await api.dispose();
  }
}

test('a hidden round leaves the owner’s feed for good, stays on their profile marked, and "Show on profile" brings it back', async ({ browser }) => {
  test.setTimeout(180_000);
  await hideSeenToHappen(browser, { width: 1280, height: 800 });
});

test('a hidden round leaves the owner’s feed for good and comes back from the profile, at phone width @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  await hideSeenToHappen(browser, { width: 390, height: 844 });
});
