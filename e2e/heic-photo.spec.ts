import { test, expect } from '@playwright/test';
import path from 'path';

// Every-phone round PR 6 (Oct 9 2026): a HEIC photo — what a Samsung with
// "high efficiency pictures" on hands Chrome — opens in the editor and posts
// as a JPEG, on a browser that cannot decode HEIC itself. The WebAssembly
// decoder is fetched ONLY on that path: a PNG pick fetches nothing extra.
// Chromium (the `mobile` and `android` projects) has no HEIC decoder, so the
// fallback runs there; WebKit on this Mac decodes HEIC natively, so the same
// spec passes there without the chunk — both are the product's behaviour.

const HEIC = path.join(__dirname, 'fixtures', 'photo.heic');
const PNG = path.join(__dirname, 'fixtures', 'photo.png');
const LIBRARY_INPUT = 'input[type="file"][multiple]';
/** The decoder is the one chunk this size (≈2 MB, ≈716 KB gzipped); the
 *  chunk's file name is a hash, so it is told apart by its weight on the wire. */
const DECODER_MIN_BYTES = 400_000;
const bigChunks = (page: import('@playwright/test').Page) =>
  page.evaluate(min =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter(e => e.name.includes('/_next/static/chunks/') && (e.transferSize > min || e.encodedBodySize > min)).length,
  DECODER_MIN_BYTES);

test('a HEIC photo opens in the editor and attaches; the decoder is fetched only for it @mobile', async ({ page, browserName }) => {
  test.setTimeout(150_000);

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  const atStart = await bigChunks(page);

  // A PNG from the library: editor-first as always, and NO decoder chunk.
  await page.locator(LIBRARY_INPUT).setInputFiles(PNG);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(1);
  expect(await bigChunks(page), 'a PNG must never fetch the HEIC decoder').toBe(atStart);

  // The HEIC: the editor opens with a frame (no "was skipped"), Done attaches a tile.
  await page.locator(LIBRARY_INPUT).setInputFiles(HEIC);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[role="status"]').filter({ hasText: 'was skipped' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('[role="status"]').filter({ hasText: 'was skipped' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(2, { timeout: 20_000 });

  // Chromium cannot decode HEIC itself, so the fallback — and its chunk — ran.
  if (browserName === 'chromium') {
    expect(await bigChunks(page), 'the HEIC decoder chunk was fetched for the HEIC').toBe(atStart + 1);
  }
});
