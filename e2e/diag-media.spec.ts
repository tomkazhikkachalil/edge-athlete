import path from 'path';
import { test, expect } from '@playwright/test';

// The media diagnostic page (Sep 3 2026, round 9): every step the composer
// runs on a picked file, logged on screen. Headless cannot run a camera, but
// the library input exercises the same pipeline; this pins that each step
// reports a line (with dimensions where it decodes) rather than stalling.
test('the media diagnostic logs every pipeline step for a library pick @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/app/diag/media');
  await expect(page.getByRole('heading', { name: 'Media diagnostic' })).toBeVisible({ timeout: 20_000 });

  const log = page.getByTestId('diag-log');
  await expect(log).toContainText('[env] webgl2', { timeout: 20_000 });
  await expect(log).toContainText('[ready]', { timeout: 20_000 });

  await page.getByTestId('diag-library-input').setInputFiles(path.join(__dirname, 'fixtures', 'photo.png'));

  await expect(log).toContainText('[change] library: 1 file(s)');
  await expect(log).toContainText('[file] photo.png · image/png');
  await expect(log).toContainText('[validate] accepted 1');
  await expect(log).toContainText(/\[img\.decode\] \d+×\d+ \d+ms/, { timeout: 30_000 });
  await expect(log).toContainText(/\[editor\] decodeImage \d+×\d+/, { timeout: 30_000 });
  await expect(log).toContainText(/\[renderImage\] image\/jpeg \d+KB/, { timeout: 30_000 });
  await expect(log).toContainText('[done]', { timeout: 30_000 });
  // Nothing failed along the way on an engine that supports the pipeline.
  await expect(log).not.toContainText('FAILED');
  await expect(log).not.toContainText('[unhandledrejection]');
});
