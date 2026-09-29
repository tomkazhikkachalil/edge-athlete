import { test, expect, type Browser } from '@playwright/test';
import { E2E_BASE_URL, adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState, readErrorBody, type QaUser } from './helpers/qa-user';

// Play program P5 (Sep 28 2026): a public result has a public page and a
// share image. /r/[postId] is viewer-independent — it renders SIGNED OUT
// for a public post of a public profile, names its 1200×630 card as
// og:image, and redirects a private one to the in-app link (the normal
// privacy gate); the image 404s for anything without a public card. The
// post's Share button hands out /r/<id>. A fresh public athlete per test.

const HOLES_77 = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, score: i === 0 ? 3 : i <= 6 ? 5 : 4 }));
const SIGNED_OUT = { cookies: [], origins: [] };

async function athleteWithRound(browser: Browser, visibility: 'public' | 'private' = 'public'): Promise<{ user: QaUser; postId: string; handle: string }> {
  const admin = adminClient();
  const user = await createQaUser({ displayName: 'Card Golfer', firstName: 'Card', lastName: 'Golfer' });
  const handle = `edgeqa-${user.id.slice(0, 8)}`;
  await admin.from('profiles').update({ handle, visibility: 'public' }).eq('id', user.id);
  const ctx = await browser.newContext({ storageState: await mintStorageState(user), extraHTTPHeaders: bypassHeaders() });
  try {
    const res = await ctx.request.post(`${E2E_BASE_URL}/api/posts`, {
      data: {
        caption: `Card round ${Date.now()}`,
        visibility,
        postType: 'golf',
        golfData: { date: '2026-09-20', courseName: 'QA Card Links', holes: '18', coursePar: 72, holesData: HOLES_77 },
      },
    });
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    return { user, postId: (await res.json()).post.id as string, handle };
  } finally {
    await ctx.close();
  }
}

test('a public result: the signed-out page, its og:image, the image itself, and the profile link', async ({ browser }) => {
  test.setTimeout(120_000);
  const { user, postId, handle } = await athleteWithRound(browser);
  const anon = await browser.newContext({ storageState: SIGNED_OUT, extraHTTPHeaders: bypassHeaders() });
  try {
    const page = await anon.newPage();
    const res = await page.goto(`/r/${postId}`);
    expect(res?.status()).toBe(200);
    const card = page.locator('[data-share-card="golf"]');
    await expect(card.getByRole('heading', { name: 'Card Golfer' })).toBeVisible();
    await expect(card.locator('[data-share-hero]')).toHaveText('77');
    await expect(card.getByText('+5 to par')).toBeVisible();
    await expect(card.getByText('QA Card Links · 18 holes')).toBeVisible();
    await expect(card.getByText('Self-reported')).toBeVisible();
    const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(og).toMatch(new RegExp(`/r/${postId}/card\\.png$`));
    await expect(page).toHaveTitle(/Card Golfer shot 77 at QA Card Links/);
    // Never a dead end signed out: the header's Log in / Sign up, the profile, the app.
    await expect(page.getByRole('link', { name: /See Card Golfer/ })).toHaveAttribute('href', `/u/@${handle}`);
    await expect(page.getByRole('link', { name: 'Track your own on Edge Athlete' })).toBeVisible();

    const img = await anon.request.get(`${E2E_BASE_URL}/r/${postId}/card.png`);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toContain('image/png');
    expect((await img.body()).byteLength).toBeGreaterThan(5_000);
  } finally {
    await anon.close();
    await deleteQaUser(user.id);
  }
});

test('no public card: a private post redirects to the in-app link, its image 404s, an unknown id is the 404 page', async ({ browser }) => {
  test.setTimeout(120_000);
  const { user, postId } = await athleteWithRound(browser, 'private');
  const anon = await browser.newContext({ storageState: SIGNED_OUT, extraHTTPHeaders: bypassHeaders() });
  try {
    const raw = await anon.request.get(`${E2E_BASE_URL}/r/${postId}`, { maxRedirects: 0 });
    expect([307, 308]).toContain(raw.status());
    expect(raw.headers()['location']).toContain(`/athlete/${user.id}?post=${postId}`);
    expect((await anon.request.get(`${E2E_BASE_URL}/r/${postId}/card.png`)).status()).toBe(404);

    // A public post of a PRIVATE profile has no public card either.
    await adminClient().from('posts').update({ visibility: 'public' }).eq('id', postId);
    await adminClient().from('profiles').update({ visibility: 'private' }).eq('id', user.id);
    expect((await anon.request.get(`${E2E_BASE_URL}/r/${postId}/card.png`)).status()).toBe(404);

    const missing = await anon.request.get(`${E2E_BASE_URL}/r/00000000-0000-4000-8000-000000000000`);
    expect(missing.status()).toBe(404);
  } finally {
    await anon.close();
    await deleteQaUser(user.id);
  }
});

test('the result page at phone width, signed out @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const { user, postId } = await athleteWithRound(browser);
  const anon = await browser.newContext({ storageState: SIGNED_OUT, extraHTTPHeaders: bypassHeaders(), viewport: { width: 390, height: 844 } });
  try {
    const page = await anon.newPage();
    await page.goto(`/r/${postId}`);
    await expect(page.locator('[data-share-hero]')).toHaveText('77');
    await expect(page.getByRole('link', { name: 'Track your own on Edge Athlete' })).toBeInViewport({ ratio: 0.5 }).catch(async () => {
      await page.getByRole('link', { name: 'Track your own on Edge Athlete' }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('link', { name: 'Track your own on Edge Athlete' })).toBeVisible();
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);
  } finally {
    await anon.close();
    await deleteQaUser(user.id);
  }
});
