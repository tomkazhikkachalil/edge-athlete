import { test, expect, type Page } from './helpers/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Who sees a post is the ACCOUNT's call (Oct 9 2026, Tom): the composer's
// one control is the feed SWITCH (269, Oct 19 2026) — on by default, its line
// says who will see the post (anyone on a public account, approved fans on a
// private one); off, the post still stands on the profile, not on the feed.
// The choice is remembered per kind on the device. Never a per-post
// Public / Private audience.

async function openComposer(page: Page) {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible({ timeout: 20_000 });
}

async function run(page: Page) {
  const admin = adminClient();
  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', user.id).single();
  const caption = `Off the feed ${Date.now()}`;
  let postId: string | null = null;
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', user.id);
    await openComposer(page);
    const toggle = page.locator('[data-composer-audience] [data-feed-toggle]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle.locator('[data-feed-toggle-line]')).toContainText('Anyone can see it');
    // No per-post audience switch.
    await expect(page.locator('input[type="radio"][value="private"]')).toHaveCount(0);

    await admin.from('profiles').update({ visibility: 'private' }).eq('id', user.id);
    await openComposer(page);
    await expect(toggle.locator('[data-feed-toggle-line]')).toContainText('approved fans');

    // Off → the post is published with the switch off: on the profile, not on the feed.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle.locator('[data-feed-toggle-line]')).toContainText('Not on the feed');
    await page.getByPlaceholder('Share your thoughts...').fill(caption);
    await page.getByRole('button', { name: 'Create Post', exact: true }).click();
    await expect.poll(async () => {
      const { data } = await admin.from('posts').select('id, on_feed, status').eq('profile_id', user.id).eq('caption', caption).maybeSingle();
      postId = data?.id ?? null;
      return data ? `${data.status}:${data.on_feed}` : null;
    }, { timeout: 20_000 }).toBe('published:false');
    const feed = await api.get('/api/posts?limit=50');
    expect(((await feed.json()).posts as Array<{ id: string }>).map(p => p.id)).not.toContain(postId);
    const own = await api.get(`/api/posts?userId=${user.id}&limit=50`);
    expect(((await own.json()).posts as Array<{ id: string }>).map(p => p.id)).toContain(postId);

    // Remembered for the next post of this kind on this device.
    await openComposer(page);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  } finally {
    await page.evaluate(() => { try { localStorage.removeItem('ea:post:feed:v1'); } catch { /* private mode */ } }).catch(() => undefined);
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', user.id);
    await api.dispose();
  }
}

test('the composer: Post to feed is on by default and says who sees it; off posts to the profile only (desktop)', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page);
});

test('the composer: Post to feed is on by default and says who sees it; off posts to the profile only @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page);
});
