import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Likes you can trust (Tom, Oct 4 2026): the count is the recount; the heart
// agrees on every surface (the feed, the profile's detail modal) because the
// tab keeps ONE liked truth (src/lib/likes/store.ts) and the server says who
// it resolved; a heart that is only a count is an outline; the like count
// never touches the comment icon. One body, two registrations (desktop /
// the phone projects).

async function likes(browser: Browser) {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const bravo = loadQaUser('user-b.json');
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const stamp = Date.now().toString(36);
  let postId: string | null = null;
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', bravo.id).single();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', bravo.id);
    // Bravo's public post — a stat line, so it is a TILE on the profile grid
    // (a text-only post is a notion: the rail, not the grid) — with a comment to like.
    let res = await bravoApi.post('/api/posts', {
      data: { caption: `Heart me ${stamp}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-21', opponent: 'Bears', result: 'W', stats: { goals: 2, assists: 0 } } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    postId = (await res.json()).post.id as string;
    res = await bravoApi.post('/api/comments', { data: { postId, content: `A comment ${stamp}` } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    const commentId = ((await res.json()).comment?.id ?? (await admin.from('post_comments').select('id').eq('post_id', postId).limit(1).single()).data?.id) as string;

    // The API: like → count 1 and the viewer's flag; the single-post GET says who it resolved.
    res = await alphaApi.post('/api/posts/like', { data: { postId } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect((await res.json()).likesCount).toBe(1);
    res = await alphaApi.get(`/api/posts?postId=${postId}`);
    const single = (await res.json()) as { post: { likes_count: number; likes: { profile_id: string }[] }; viewer: string | null };
    expect(single.viewer).toBe(alpha.id);
    expect(single.post.likes_count).toBe(1);
    expect(single.post.likes.map(l => l.profile_id)).toEqual([alpha.id]);
    expect(res.headers()['cache-control']).toContain('no-store');
    // A comment like's count is the recount, and the row carries only the viewer's own like.
    res = await alphaApi.post('/api/comments/like', { data: { commentId } });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    expect(await res.json()).toMatchObject({ isLiked: true, likes_count: 1 });
    res = await alphaApi.get(`/api/comments?postId=${postId}`);
    const comments = ((await res.json()).comments as { id: string; likes_count: number; comment_likes: { profile_id: string }[] }[]);
    const mine = comments.find(c => c.id === commentId)!;
    expect(mine.likes_count).toBe(1);
    expect(mine.comment_likes.map(l => l.profile_id)).toEqual([alpha.id]);
    // Unlike through the API so the UI pass starts clean.
    res = await alphaApi.post('/api/posts/like', { data: { postId } });
    expect((await res.json()).likesCount).toBe(0);

    // The UI, as alpha.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await ctx.newPage();
      // 1. The feed: like it — heart on, count 1.
      await page.goto('/feed');
      const card = page.locator('[data-testid="post-card"]').filter({ hasText: `Heart me ${stamp}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const likeBtn = card.locator('[data-post-like]');
      await expect(likeBtn).toHaveAttribute('data-post-like', 'off');
      await likeBtn.click();
      await expect(likeBtn).toHaveAttribute('data-post-like', 'on');
      await expect(likeBtn).toContainText('1');
      await expect.poll(async () => (await admin.from('posts').select('likes_count').eq('id', postId!).single()).data?.likes_count, { timeout: 10_000 }).toBe(1);
      // The gap: the like count never touches the comment icon.
      const gap = await card.evaluate(el => {
        const like = el.querySelector('[data-post-like]')!.getBoundingClientRect();
        const comment = el.querySelector('[data-post-comment]')!.getBoundingClientRect();
        return comment.left - like.right;
      });
      expect(gap, 'air between the like count and the comment icon').toBeGreaterThanOrEqual(12);

      // 2. The same post from bravo's profile: the modal's heart is FILLED, the count agrees.
      await page.goto(`/athlete/${bravo.id}`);
      const tile = page.locator(`[data-post-id="${postId}"]`).first();
      await expect(tile).toBeVisible({ timeout: 30_000 });
      // The grid's heart is a count, never state — an outline.
      expect(await tile.locator('i.far.fa-heart').count()).toBe(1);
      await tile.click();
      const modal = page.locator('[data-post-detail]');
      const modalLike = modal.locator('[data-post-like]');
      await expect(modalLike).toHaveAttribute('data-post-like', 'on', { timeout: 20_000 });
      await expect(modalLike).toContainText('1');
      // 3. Unlike there; the feed agrees after a reload.
      await modalLike.click();
      await expect(modalLike).toHaveAttribute('data-post-like', 'off');
      await expect.poll(async () => (await admin.from('posts').select('likes_count').eq('id', postId!).single()).data?.likes_count, { timeout: 10_000 }).toBe(0);
      await page.goto('/feed');
      const again = page.locator('[data-testid="post-card"]').filter({ hasText: `Heart me ${stamp}` }).first();
      await expect(again).toBeVisible({ timeout: 30_000 });
      await expect(again.locator('[data-post-like]')).toHaveAttribute('data-post-like', 'off');
      await expect(again.locator('[data-post-like]')).toContainText('0');
    } finally {
      await ctx.close();
    }
  } finally {
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await admin.from('profiles').update({ visibility: prior?.visibility ?? 'private' }).eq('id', bravo.id);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
}

test('likes: the recount, one heart on the feed and the profile, outline counts, air before the comment icon', async ({ browser }) => {
  test.setTimeout(180_000);
  await likes(browser);
});

test('likes: the recount, one heart on the feed and the profile, outline counts, air before the comment icon @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  await likes(browser);
});
