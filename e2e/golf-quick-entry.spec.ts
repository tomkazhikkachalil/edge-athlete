import { test, expect } from '@playwright/test';

// The ALREADY-PLAYED ending of the unified flow (one flow, two modes): same
// form as a live round, one-pass score entry, publishes once — no Individual/
// Shared fork anymore (the old "Individual Round" toggle and its separate
// scorecard form were retired by the flow unification).
test('log an already-played round and see the scorecard post', async ({ page }) => {
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

  // Typing sets courseName directly — no suggestion needs to exist for a
  // manual course. (Earlier revisions of this comment claimed Escape closes
  // the whole composer — no Escape handler exists in the composer chain
  // today, but a click is still how the dropdown is dismissed for real.)
  const courseInput = page.getByPlaceholder(/search for a golf course/i);
  await courseInput.fill(courseName);

  // Blur the course-suggestions dropdown shut by clicking the already-selected
  // "Outdoor" round-type button — a state no-op (the 9/18 holes selector this
  // used to click was removed: hole count is now DERIVED from the scores
  // entered).
  await page.getByRole('button', { name: /outdoor/i }).click();
  await page.waitForTimeout(300);

  // Hole scores. Since the Aug 2026 scorecard convergence (#119-#121) a SOLO
  // round renders the shared MultiPlayerScorecardGrid, so the placeholder is
  // an ASCII "-", not the U+2212 "−" the old solo-only form used — hence
  // exact: true, which also stops the substring match from catching any other
  // placeholder containing a hyphen. Stats are checkboxes in this grid (no
  // putts row), so every match IS a score cell; OUT/IN totals are computed.
  // Filling the front nine alone satisfies the submit gate.
  const holeInputs = page.getByPlaceholder('-', { exact: true });
  await expect(holeInputs.first()).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 9; i++) {
    await holeInputs.nth(i).fill('4');
  }

  await page.getByRole('button', { name: 'Create Post', exact: true }).click();

  // Modal closes; the round renders in the feed with its course name.
  await expect(page.getByPlaceholder(/search for a golf course/i))
    .toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(courseName).first()).toBeVisible({ timeout: 20_000 });
});

// The SHARED path (the "Playing now" default). Score Entry used to be gated on
// having playing partners, so composing a solo round showed no scorecard at all
// and your own scores could not be entered. The creator's row is now seeded up
// front — and, critically, seeding it must NOT count as unsaved work.
test('shared golf round: the creator is on the scorecard before any partner', async ({ page }) => {
  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await page.getByRole('button', { name: /general post/i }).click();
  const sportSelector = page.locator('div[class*="z-[60]"]');
  await sportSelector.getByPlaceholder('Search sports...').fill('golf');
  await sportSelector.getByRole('button', { name: /golf/i }).first().click();

  // Present immediately — no partner added, nothing typed.
  await expect(page.getByRole('heading', { name: 'Score Entry' })).toBeVisible({ timeout: 15_000 });

  const playerRows = page.locator('table').first().locator('tbody tr');
  await expect(playerRows).toHaveCount(1);
  // ...and the row is the composer, not a placeholder. globalSetup names
  // user A "Edge QA Alpha", so the grid's short name starts "Edge".
  await expect(playerRows.first()).toContainText('Edge');

  // The regression this guards: a seeded row is not work in progress, so
  // closing an untouched composer must not ask to discard anything.
  await page.getByRole('button', { name: 'Close modal' }).click();
  await expect(page.getByText(/discard/i)).toHaveCount(0);
});

// The phone-first path (#345 + phone polish pass): the composer's headline
// "Quick entry" button opens the hole-by-hole stepper, and a score committed
// there lands back in the grid. Asserted at 375px — the tightest mainstream
// phone — because the mobile project's 390px viewport leaves ~15px of slack
// in exactly the header row this button lives in.
test('@mobile Quick entry opens the stepper and writes back to the grid', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await page.getByRole('button', { name: /general post/i }).click();
  const sportSelector = page.locator('div[class*="z-[60]"]');
  await sportSelector.getByPlaceholder('Search sports...').fill('golf');
  await sportSelector.getByRole('button', { name: /golf/i }).first().click();

  await expect(page.getByRole('heading', { name: 'Score Entry' })).toBeVisible({ timeout: 15_000 });

  const quickEntry = page.getByRole('button', { name: 'Quick entry' });
  await expect(quickEntry).toBeVisible();
  // 44px touch floor, held at 375px.
  const box = await quickEntry.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await quickEntry.click();

  // Stepper is open: hole context line plus both wheels.
  const strokes = page.getByRole('spinbutton', { name: 'Strokes' });
  await expect(strokes).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Putts' })).toBeVisible();

  // Nothing may overflow the 375px viewport with the stepper open.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Commit hole 1: typing a digit on the wheel commits it (same contract the
  // AT/keyboard path uses).
  await strokes.press('5');
  await expect(strokes).toHaveAttribute('aria-valuenow', '5');

  // "Save Scores" is the LAST hole's footer button (every other hole shows
  // Next) — jump straight there. The stepper overlay is the only z-[60]
  // layer open, which scopes the numeric button away from the page behind.
  const stepper = page.locator('div[class*="z-[60]"]');
  await stepper.getByRole('button', { name: '18', exact: true }).click();
  await stepper.getByRole('button', { name: 'Save Scores' }).click();

  // Modal closed; the grid's hole-1 cell now carries the committed score.
  await expect(strokes).toBeHidden();
  const holeInputs = page.getByPlaceholder('-', { exact: true });
  await expect(holeInputs.first()).toHaveValue('5');
});
