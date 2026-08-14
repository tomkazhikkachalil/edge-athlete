import { test, expect } from '@playwright/test';

// Authenticated via the minted storageState (playwright.config.ts default).
test('create a text post from the feed composer and see it render', async ({ page }) => {
  // Against a real deployment this spec has to survive a cold serverless
  // function on top of the round trip; the default 60s left no headroom once
  // two 15s waits and a reload were in play.
  test.setTimeout(120_000);
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

  // Modal closes and the new post shows in the feed. 30s, not 15s: the POST
  // itself is fast (verified directly against production — 200, and the post
  // persists), but the feed's refetch after the composer closes is what races,
  // and 15s was marginal enough to flake three times against a deployment.
  // A longer window still fails outright if the post never appears; it only
  // stops a slow-but-correct render being reported as a defect.
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });

  // "view it": reload and confirm the post persisted (not just optimistic UI).
  await page.reload();
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
});
