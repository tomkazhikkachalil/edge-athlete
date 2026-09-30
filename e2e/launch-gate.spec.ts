import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, mintStorageState, bypassHeaders } from './helpers/qa-user';

// The launch gate (Sep 30 2026): runs only against a build made with
// NEXT_PUBLIC_LAUNCH_GATE=1 (the flag is build-injected; CI's build is not gated).
// Signed out: everything but the doors → /auth/coming-soon; the crawler
// files forbid indexing; the sign-up API refuses. Signed in: the app.

test.skip(process.env.NEXT_PUBLIC_LAUNCH_GATE !== '1', 'NEXT_PUBLIC_LAUNCH_GATE is not set for this build');

test('signed out: coming soon everywhere but the doors; robots forbid; signup refused @mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  try {
    for (const path of ['/', '/feed', '/u/someone', '/org/some-club', '/register']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/auth\/coming-soon$/);
      await expect(page.locator('[data-coming-soon]')).toBeVisible();
    }
    await page.locator('[data-coming-soon-signin]').click();
    await expect(page).toHaveURL(/\/\?signin=1$/);
    await expect(page.getByRole('heading', { name: /login to your account/i })).toBeVisible({ timeout: 15_000 });

    const robots = await page.request.get('/robots.txt');
    expect(await robots.text()).toContain('Disallow: /');
    expect((await page.request.get('/sitemap.xml')).status()).toBe(404);
    expect((await page.request.get('/privacy')).status()).toBe(200);

    const signup = await page.request.post('/api/signup', { data: { email: 'nobody@example.com', password: 'Xx!12345678', firstName: 'No', lastName: 'Body' } });
    expect(signup.status()).toBe(403);
  } finally {
    await ctx.close();
  }
});

test('signed in: the app as usual', async ({ browser }) => {
  const u = await createQaUser({ displayName: 'Gate Gil', firstName: 'Gate', lastName: 'Gil' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  try {
    await page.goto('/feed');
    await expect(page).toHaveURL(/\/feed/);
    await expect(page.locator('[data-coming-soon]')).toHaveCount(0);
  } finally {
    await ctx.close();
    await deleteQaUser(u.id);
  }
});
