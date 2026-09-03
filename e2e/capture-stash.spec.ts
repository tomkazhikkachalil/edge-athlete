import path from 'path';
import { test, expect } from '@playwright/test';

// Capture recovery (Sep 3 2026, Tom's device pass): on an iPhone, taking a
// photo from the feed composer ended in a page reload and a lost photo.
// Picked/captured files are now stashed in IndexedDB the instant they reach
// the page (before the editor's full-resolution decode), and the next
// composer open offers them back. Headless can't run the camera, but the
// reload-after-arrival half is exactly reproducible: pick → editor opens →
// reload → banner → Restore → editor on the same file → Done → tile. Then
// removing the tile must empty the stash so a later open shows nothing.
test('a photo that reached the page survives a reload via the stash @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = path.join(__dirname, 'fixtures', 'rotated6.jpg');

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });

  // The reload iOS inflicts — before Done, so nothing but the stash has it.
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const banner = page.getByRole('status').filter({ hasText: 'before the page reloaded' });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('Your photo');
  await banner.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible();
  await expect(banner).toBeHidden();

  // Removing the tile empties the stash: a reload + reopen offers nothing.
  await page.getByRole('button', { name: 'Remove media' }).click();
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'before the page reloaded' })).toHaveCount(0);
});
