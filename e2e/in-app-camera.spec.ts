import { test, expect } from '@playwright/test';

// The in-app camera (Sep 3 2026, round 10): the composer's fallback for a
// native photo picker that fails inside iOS's own screen. The `mobile` project
// launches Chromium with a fake camera device (playwright.config.ts), so the
// stream → shutter → File → editor path is testable; WebKit has no fake device.
test('the in-app camera hands a photo to the editor @mobile', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no fake camera device; the path is proved on Chromium');
  test.setTimeout(120_000);

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();

  // Touch-only affordance: the mobile project's device has maxTouchPoints > 1
  // only when emulated — set it so the link renders, as it would on a phone.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  });
  await page.reload();
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await page.getByRole('button', { name: 'Camera not working? Use the in-app camera' }).click();

  const dialog = page.getByRole('dialog', { name: 'In-app camera' });
  await expect(dialog).toBeVisible();
  const video = page.getByTestId('in-app-camera-video');
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);

  await dialog.getByRole('button', { name: 'Capture photo' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible();
});
