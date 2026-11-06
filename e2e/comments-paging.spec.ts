import { test, expect } from './helpers/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

/**
 * Comments page by THREAD (SCALE_AUDIT hole 12, Nov 6 2026): thirty root
 * comments a page, each root's replies riding along; the client shows
 * "Show more comments" and appends the next page. A reader used to get a
 * flat 100 and never a 101st.
 */
test('33 root comments and a reply: page one holds 30 roots + the reply, page two the last 3; the UI loads them @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs('state.json');
  const stamp = Date.now().toString(36);
  let postId = '';
  try {
    const created = await api.post('/api/posts', { data: { caption: `QA comments paging ${stamp}`, visibility: 'public', postType: 'general' } });
    expect(created.ok(), await readErrorBody(created)).toBe(true);
    postId = (await created.json()).post.id as string;
    expect(postId).toBeTruthy();

    // 33 roots, oldest first; a reply under the first root.
    let firstRootId = '';
    for (let i = 1; i <= 33; i++) {
      const res = await api.post('/api/comments', { data: { postId, content: `root ${String(i).padStart(2, '0')} ${stamp}` } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      if (i === 1) firstRootId = ((await res.json()).comment?.id) as string;
    }
    const reply = await api.post('/api/comments', { data: { postId, content: `reply ${stamp}`, parentCommentId: firstRootId } });
    expect(reply.ok(), await readErrorBody(reply)).toBe(true);

    // Page one: 30 roots + the reply (its root is on the page), hasMore, nextOffset 30.
    const p1 = await api.get(`/api/comments?postId=${postId}`);
    expect(p1.ok(), await readErrorBody(p1)).toBe(true);
    const page1 = (await p1.json()) as { comments: { id: string; parent_comment_id: string | null; content: string }[]; hasMore: boolean; nextOffset: number };
    expect(page1.comments.filter(c => !c.parent_comment_id).length).toBe(30);
    expect(page1.comments.filter(c => c.parent_comment_id === firstRootId).length).toBe(1);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(30);
    // Page two: the last three roots, no more.
    const p2 = await api.get(`/api/comments?postId=${postId}&offset=${page1.nextOffset}`);
    const page2 = (await p2.json()) as { comments: { id: string; parent_comment_id: string | null }[]; hasMore: boolean };
    expect(page2.comments.filter(c => !c.parent_comment_id).length).toBe(3);
    expect(page2.hasMore).toBe(false);

    // The UI: the post opened from the feed shows 30 threads and "Show more comments"; a tap brings the last three.
    await page.goto(`/feed?post=${postId}`);
    const popup = page.locator('[data-post-detail]');
    await expect(popup).toBeVisible({ timeout: 20_000 });
    await popup.getByRole('button', { name: /View Comments/ }).click();
    const more = popup.locator('[data-comments-more]');
    await expect(more).toBeVisible({ timeout: 30_000 });
    await expect(popup.getByText(`root 31 ${stamp}`)).toHaveCount(0);
    await more.click();
    await expect(popup.getByText(`root 33 ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(more).toHaveCount(0);
  } finally {
    if (postId) await api.delete(`/api/posts/${postId}`).catch(() => undefined);
    await api.dispose();
  }
});
