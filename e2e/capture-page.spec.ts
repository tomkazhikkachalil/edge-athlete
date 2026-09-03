import path from 'path';
import { test, expect } from '@playwright/test';

// Rounds 3 and 7 of the iPhone camera bug (Sep 3 2026). Headless cannot run
// the native camera, but both halves are reproducible:
//  1. the light capture page opens the composer's editor ON THE PAGE, on the
//     picked file — no storage, no navigation until the post exists (round 7:
//     the IndexedDB hand-off to /feed lost the photo silently on iOS 15);
//  2. a camera session that ends in a reload is reported by the composer's
//     capture-failure notice, mono diagnostic line included.

test('the light capture page opens the editor on the photo and posts from there @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = path.join(__dirname, 'fixtures', 'rotated6.jpg');
  const marker = `Capture page post ${Date.now()}`;

  await page.goto('/app/capture');
  await expect(page.getByRole('heading', { name: 'Take a photo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
  // CaptureInputs' photo input (single-file, accept=image/*) — the camera's
  // hand-back, minus the camera.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixture);

  // The editor opens HERE — the photo never leaves the page.
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/app\/capture/);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible();
  // No recovery notice — these are the page's own captures, not a crash's.
  await expect(page.getByRole('status').filter({ hasText: 'before the page reloaded' })).toHaveCount(0);

  // Post from the light page; the feed is where the post lands.
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();
  await expect(page).toHaveURL(/\/feed/, { timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
});

test('a camera session that ends in a reload is reported with its diagnostic @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();

  // Arm: the tap that opens the camera. Headless opens a file chooser we
  // simply never answer — exactly a camera that never hands a file back.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Take photo' }).click();
  await chooser;

  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const notice = page.getByRole('status').filter({ hasText: 'camera closed without returning a photo' });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('Safari reloaded the page');
  await expect(notice).toContainText('boot changed');
  await expect(notice).toContainText('gate flips 0');
  await expect(notice.getByRole('link', { name: 'Try the light capture page' })).toHaveAttribute('href', '/app/capture');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();

  // Dismissed for good: a reload + reopen shows nothing.
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'camera closed' })).toHaveCount(0);
});
