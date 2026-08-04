import { test, expect } from '@playwright/test';

// Stretch spec: an individual golf round through the real composer —
// sport selection, batch timing, scorecard entry, post, feed render.
test('log an individual golf round and see the scorecard post', async ({ page }) => {
  const courseName = `QA Smoke Course ${Date.now()}`;

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();

  // Post Type → sport selector → Golf. The selector is a z-[60] overlay ON
  // TOP of the composer, so an unscoped /golf/i can resolve to a covered
  // element underneath — scope every click to the overlay.
  await page.getByRole('button', { name: /general post/i }).click();
  const sportSelector = page.locator('div[class*="z-[60]"]');
  await sportSelector.getByPlaceholder('Search sports...').fill('golf');
  await sportSelector.getByRole('button', { name: /golf/i }).first().click();

  // Batch entry ("Playing now" would arm the live flow and a Go Live button)
  await page.getByRole('button', { name: /already played/i }).click();
  await page.getByRole('button', { name: /individual round/i }).click();

  // Typing sets courseName directly — no suggestion needs to exist for a
  // manual course. Do NOT press Escape to dismiss the suggestions dropdown:
  // Escape closes the whole composer.
  const courseInput = page.getByPlaceholder(/search famous courses/i);
  await courseInput.fill(courseName);

  // The hole grid initializes only when the hole COUNT changes (default 18
  // starts with an empty grid for a manual course) — picking "9 holes" is
  // the deterministic way to materialize editable score cells, and the click
  // also blurs the course-suggestions dropdown shut.
  await page.getByRole('button', { name: '9 holes', exact: true }).click();
  await page.waitForTimeout(300);

  // Hole scores: the score row and putts row share placeholder "−"; DOM is
  // row-major so the first nine matches are the SCORE cells.
  const holeInputs = page.getByPlaceholder('−');
  await expect(holeInputs.first()).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 9; i++) {
    await holeInputs.nth(i).fill('4');
  }

  await page.getByRole('button', { name: 'Create Post', exact: true }).click();

  // Modal closes; the round renders in the feed with its course name.
  await expect(page.getByPlaceholder(/search famous courses/i))
    .toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(courseName).first()).toBeVisible({ timeout: 20_000 });
});
