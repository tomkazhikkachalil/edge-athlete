import { test, expect, type Page } from './helpers/test';
import { slidePost } from './helpers/composer';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';

// Who sees a post is the ACCOUNT's call (Oct 9 2026, Tom). A GENERAL post has
// no control at all (Tom, Nov 26 2026): no audience, no "Post to feed" switch
// — it always goes to the feed and the profile. A sport's stat-line post
// keeps the feed switch (269): on by default, its line says who will see the
// post; off, the post still stands on the profile, not on the feed. Never a
// per-post Public / Private audience.

async function openComposer(page: Page) {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts')).toBeVisible({ timeout: 20_000 });
}

async function run(page: Page) {
  const admin = adminClient();
  const user = loadQaUser('user.json');
  const api = await apiAs('state.json');
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', user.id).single();
  const caption = `Always on the feed ${Date.now()}`;
  let postId: string | null = null;
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', user.id);
    await openComposer(page);
    // The General post: no switch, no audience control.
    await expect(page.locator('[data-composer-audience]')).toHaveCount(0);
    await expect(page.locator('[data-feed-toggle]')).toHaveCount(0);
    await expect(page.locator('input[type="radio"][value="private"]')).toHaveCount(0);

    // A sport's post keeps the feed switch, and its line follows the account.
    await page.getByRole('button', { name: /general post/i }).click();
    const picker = page.locator('div[class*="z-[60]"]');
    await picker.getByPlaceholder('Search sports').fill('mma');
    await picker.getByRole('button', { name: /mma/i }).first().click();
    const toggle = page.locator('[data-composer-audience] [data-feed-toggle]');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(toggle.locator('[data-feed-toggle-line]')).toContainText('Anyone can see it');
    await page.locator('[data-post-type-clear]').click();
    await expect(page.locator('[data-composer-audience]')).toHaveCount(0);

    // Posted: on the feed AND on the profile, whatever this device remembered for a sport's post.
    await page.evaluate(() => { try { localStorage.setItem('ea:post:feed:v1', JSON.stringify({ sport: false, workout: false, activity: false })); } catch { /* private mode */ } });
    await page.getByPlaceholder('Share your thoughts').fill(caption);
    await slidePost(page);
    await expect.poll(async () => {
      const { data } = await admin.from('posts').select('id, on_feed, status').eq('profile_id', user.id).eq('caption', caption).maybeSingle();
      postId = data?.id ?? null;
      return data ? `${data.status}:${data.on_feed}` : null;
    }, { timeout: 20_000 }).toBe('published:true');
    const feed = await api.get('/api/posts?limit=50');
    expect(((await feed.json()).posts as Array<{ id: string }>).map(p => p.id)).toContain(postId);
    const own = await api.get(`/api/posts?userId=${user.id}&limit=50`);
    expect(((await own.json()).posts as Array<{ id: string }>).map(p => p.id)).toContain(postId);
  } finally {
    await page.evaluate(() => { try { localStorage.removeItem('ea:post:feed:v1'); } catch { /* private mode */ } }).catch(() => undefined);
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', user.id);
    await api.dispose();
  }
}

test('the composer: a General post has no switch and goes to the feed; a sport\'s post keeps it (desktop)', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page);
});

test('the composer: a General post has no switch and goes to the feed; a sport\'s post keeps it @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await run(page);
});
