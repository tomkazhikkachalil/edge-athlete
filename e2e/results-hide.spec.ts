import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { purgeGolfRound, purgePost } from './helpers/results';

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
    const list = (await (await alphaApi.get('/api/results/visibility')).json()) as { rounds: Array<{ id: string }>; posts: Array<{ id: string }> };
    expect(list.rounds.map(r => r.id)).toContain(roundId);
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
