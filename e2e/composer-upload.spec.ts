import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

// Video posters program, PR 2 (Oct 13 2026): media never looks broken while
// it uploads. The composer's tile shows the local file with its progress from
// the moment it is attached; Post waits for the uploads; a failure is a
// Retry that keeps the file; the connection returning retries by itself; a
// failed Post loses nothing already uploaded.

const PHOTO = join(process.cwd(), 'e2e', 'fixtures', 'photo.png');
const CAMERA_PHOTO = 'input[type="file"][accept="image/*"]';

/** Hold the upload's last step so a tile stays PENDING while we look. */
async function holdComplete(page: Page) {
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let holding = true;
  await page.route('**/api/upload/post-media/complete', async route => {
    if (holding) await held;
    await route.continue();
  });
  return () => { holding = false; release(); };
}

async function openComposer(page: Page) {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
}

test('a slow connection: the tile shows the local file with its progress before Post; Post waits for the upload; the post lands @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  await openComposer(page);
  const release = await holdComplete(page);
  await page.locator(CAMERA_PHOTO).setInputFiles(PHOTO);
  const tile = page.locator('[data-media-upload]').first();
  await expect(tile).toBeVisible({ timeout: 5_000 });
  await expect(tile).toHaveAttribute('data-media-upload', 'pending');
  await expect(tile.getByRole('progressbar', { name: 'Upload progress' })).toBeVisible();
  await expect(tile.locator('img')).toBeVisible(); // the local file, not a broken image

  const marker = `Slow upload ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  // Post waits: the composer is still open, the tile still pending.
  await page.waitForTimeout(1_500);
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await expect(tile).toHaveAttribute('data-media-upload', 'pending');
  release();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first()).toBeVisible({ timeout: 30_000 });
});

test('offline mid-upload: the tile says Upload failed with a Retry that keeps the file; back online it uploads by itself @mobile', { tag: '@mobile' }, async ({ page, context }) => {
  test.setTimeout(120_000);
  await openComposer(page);
  const release = await holdComplete(page);
  await page.locator(CAMERA_PHOTO).setInputFiles(PHOTO);
  const tile = page.locator('[data-media-upload]').first();
  await expect(tile).toHaveAttribute('data-media-upload', 'pending', { timeout: 5_000 });
  // The bytes are in storage; the completion call is what the outage hits.
  await context.setOffline(true);
  release();
  await expect(tile).toHaveAttribute('data-media-upload', 'failed', { timeout: 30_000 });
  await expect(tile.getByRole('button', { name: 'Retry upload' })).toBeVisible();
  await expect(tile.locator('img')).toBeVisible(); // the local file is still here
  await context.setOffline(false);
  // No tap: the connection's return re-queues a network failure by itself.
  await expect(tile).toHaveAttribute('data-media-upload', 'stored', { timeout: 60_000 });
  await expect(tile.getByRole('button', { name: 'Retry upload' })).toHaveCount(0);
});

test('a failed Post loses nothing: the second tap sends no new upload @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(120_000);
  await openComposer(page);
  await page.locator(CAMERA_PHOTO).setInputFiles(PHOTO);
  const tile = page.locator('[data-media-upload]').first();
  await expect(tile).toHaveAttribute('data-media-upload', 'stored', { timeout: 60_000 });
  let intents = 0;
  await page.route('**/api/upload/post-media/intent', route => { intents += 1; return route.continue(); });
  let failOnce = true;
  await page.route('**/api/posts', async route => {
    if (route.request().method() === 'POST' && failOnce) {
      failOnce = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated outage' }) });
      return;
    }
    await route.continue();
  });
  const marker = `Kept upload ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  await expect(page.getByText('Simulated outage')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await expect(tile).toHaveAttribute('data-media-upload', 'stored');
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first()).toBeVisible({ timeout: 30_000 });
  expect(intents, 'no file was uploaded again').toBe(0);
});
