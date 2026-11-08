import { test, expect } from './helpers/test';

/**
 * The installed app reopens to what it had (performance program Phase 2b,
 * Nov 2026): the profile, the pulse's numbers and the feed's first page live
 * on the device under the account's key and paint before any network answer.
 * Proven the hard way: after one ordinary open, the next open has the feed
 * read, the profile read and the pulse BLOCKED — and the page still shows the
 * person's post and name. Then the block is lifted and the read catches up.
 */
test('a reopened feed paints the remembered page and name before the network answers @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Hydration ${Date.now()}`;

  // One ordinary open that leaves a copy on the device: post, see it, reload once.
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  const composer = page.getByPlaceholder('Share your thoughts...');
  await composer.fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
  const stored = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('ea:hyd:v1:')).sort());
  expect(stored.length, `device keys: ${stored.join(', ')}`).toBeGreaterThanOrEqual(2);
  expect(stored.some((k) => k.endsWith(':profile'))).toBe(true);
  expect(stored.some((k) => k.endsWith(':feed'))).toBe(true);

  // The next open, with the network's answers for the feed, the profile and
  // the pulse held back: the page paints from the device.
  const held: string[] = [];
  await page.route(/\/api\/posts(\?|$)|\/rest\/v1\/profiles(\?|$)|\/api\/me\/pulse/, async (route) => {
    held.push(new URL(route.request().url()).pathname);
    await new Promise((r) => setTimeout(r, 20_000));
    await route.continue();
  });
  await page.goto('/feed');
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 8_000 });
  expect(held.some((p) => p === '/api/posts'), `held: ${held.join(', ')}`).toBe(true);
  await page.unroute(/\/api\/posts(\?|$)|\/rest\/v1\/profiles(\?|$)|\/api\/me\/pulse/);

  // Sign-out forgets the device's copies (a shared phone).
  await page.evaluate(() => {
    const fakeOther = 'ea:hyd:v1:other-account:feed';
    window.localStorage.setItem(fakeOther, JSON.stringify({ v: 1, userId: 'other-account', savedAt: Date.now(), value: [] }));
  });
  const before = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('ea:hyd:v1:')).length);
  expect(before).toBeGreaterThanOrEqual(3);
});
