import { test, expect, type Browser } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Impact (Tom, Oct 4 2026): a post's views are counted once per person per
// day from a hashed daily mark, shown to everyone, never for the author's own
// looks. One body, two registrations (desktop / the phone projects).

// Headless Chromium says "HeadlessChrome" in its user agent, which the
// beacon's bot filter refuses on purpose (a real person's browser never
// does); the harness contexts wear a real browser's agent for this spec.
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function views(browser: Browser) {
  const admin = adminClient();
  const alpha = loadQaUser('user.json');
  const probe = await admin.from('post_view_marks').select('post_id').limit(1);
  test.skip(!!probe.error, `migration 252 not applied on this target (${probe.error?.code})`);
  const alphaApi = await apiAs('state.json');
  const bravoApi = await apiAs('state-b.json');
  const stamp = Date.now().toString(36);
  let postId: string | null = null;
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', alpha.id).single();
  const count = async () => (await admin.from('posts').select('views_count, plays_count').eq('id', postId!).single()).data as { views_count: number; plays_count: number };
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', alpha.id);
    // A stat line, so the post is a TILE on the profile grid (a text-only post is a notion: the rail).
    let res = await alphaApi.post('/api/posts', {
      data: { caption: `Look at me ${stamp}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-22', opponent: 'Owls', result: 'W', stats: { goals: 1, assists: 2 } } },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    postId = (await res.json()).post.id as string;

    // The UI first: bravo opens the post on alpha's profile — the card beacons
    // once (half on screen for a second) and the count becomes 1. A keepalive
    // POST may emit no response event in the harness, so the proof is the
    // request plus the database.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', userAgent: REAL_UA });
    try {
      const page = await ctx.newPage();
      const beacon = page.waitForRequest(r => r.url().includes('/api/posts/views') && r.method() === 'POST', { timeout: 30_000 });
      await page.goto(`/athlete/${alpha.id}`);
      await page.locator(`[data-post-id="${postId}"]`).first().click();
      await expect(page.locator('[data-post-detail] [data-testid="post-card"]')).toBeVisible({ timeout: 20_000 });
      // Other cards on the page (featured posts, the rail) may ride the same batch.
      expect(((await beacon).postDataJSON() as { items: { id: string; kind: string }[] }).items).toContainEqual({ id: postId, kind: 'view' });
      await expect.poll(async () => (await count()).views_count, { timeout: 15_000 }).toBe(1);
    } finally {
      await ctx.close();
    }

    // The API: bravo again → still 1 (the day's mark); alpha (the author) → still 1;
    // a play is its own count; junk and oversize bodies answer 204 and bump nothing.
    res = await bravoApi.post('/api/posts/views', { data: { items: [{ id: postId, kind: 'view' }, { id: postId, kind: 'view' }] } });
    expect(res.status()).toBe(204);
    res = await alphaApi.post('/api/posts/views', { data: { items: [{ id: postId, kind: 'view' }] } });
    expect(res.status()).toBe(204);
    res = await bravoApi.post('/api/posts/views', { data: { items: [{ id: postId, kind: 'play' }] } });
    expect(res.status()).toBe(204);
    await expect.poll(async () => (await count()).plays_count, { timeout: 10_000 }).toBe(1);
    res = await bravoApi.post('/api/posts/views', { data: { items: Array.from({ length: 51 }, () => ({ id: postId, kind: 'view' })) } });
    expect(res.status()).toBe(204);
    res = await bravoApi.post('/api/posts/views', { data: { nope: true } });
    expect(res.status()).toBe(204);
    await new Promise(r => setTimeout(r, 1500));
    expect(await count()).toEqual({ views_count: 1, plays_count: 1 });

    // Everyone sees the number: the author's own feed card says "1 view · 1 play".
    const own = await browser.newContext({ storageState: 'e2e/.auth/state.json', userAgent: REAL_UA });
    try {
      const page = await own.newPage();
      await page.goto('/feed');
      const card = page.locator('[data-testid="post-card"]').filter({ hasText: `Look at me ${stamp}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.locator('[data-post-views]')).toContainText('1 view');
      await expect(card.locator('[data-post-views]')).toContainText('1 play');
    } finally {
      await own.close();
    }
  } finally {
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await admin.from('profiles').update({ visibility: prior?.visibility ?? 'private' }).eq('id', alpha.id);
    await alphaApi.dispose();
    await bravoApi.dispose();
  }
}

test('impact: one view per person per day, never the author, a play is its own count, shown to everyone', async ({ browser }) => {
  test.setTimeout(180_000);
  await views(browser);
});

test('impact: one view per person per day, never the author, a play is its own count, shown to everyone @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  await views(browser);
});
