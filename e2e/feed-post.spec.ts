import { test, expect } from '@playwright/test';

// Authenticated via the minted storageState (playwright.config.ts default).
test('create a text post from the feed composer and see it render', async ({ page }) => {
  const marker = `Smoke test post ${Date.now()}`;

  await page.goto('/feed');
  // Composer trigger — its accessible name includes the user's first name,
  // so match on the stable prefix. (Locator trap on this app: the nav drawer
  // is ALWAYS mounted off-canvas, so loose role locators can resolve to
  // hidden drawer copies; keep names anchored and specific.)
  await page.getByRole('button', { name: /what's on your mind/i }).click();

  const composer = page.getByPlaceholder('Share your thoughts...');
  await expect(composer).toBeVisible();
  await composer.fill(marker);
  // NOT /new/i or /post/i — those also match the header's "Create new post".
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();

  // Modal closes and the new post shows in the feed.
  await expect(composer).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15_000 });

  // "view it": reload and confirm the post persisted (not just optimistic UI).
  await page.reload();
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 15_000 });
});
