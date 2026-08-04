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

  // Blur the course-suggestions dropdown shut by clicking the already-selected
  // "18 holes" button — a state no-op (the change guard doesn't fire), in the
  // same control row this spec has always proven clickable. Do NOT use Escape
  // (closes the whole composer). Staying on the DEFAULT 18 holes is the point:
  // the hole grid must exist on mount for a manually-typed course — the exact
  // regression this spec now pins (holesData used to start empty until the
  // hole count changed).
  await page.getByRole('button', { name: '18 holes', exact: true }).click();
  await page.waitForTimeout(300);

  // Hole scores: the front-9 tab renders 9 hole columns; the score row and
  // putts row share placeholder "−" and the DOM is row-major, so the first
  // nine matches are the SCORE cells (OUT/IN totals are computed cells, not
  // inputs). Filling the front nine alone satisfies the submit gate.
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
