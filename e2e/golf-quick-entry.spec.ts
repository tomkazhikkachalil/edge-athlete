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
  // manual course. Do NOT press Escape to dismiss the suggestions dropdown:
  // Escape closes the whole composer.
  const courseInput = page.getByPlaceholder(/search for a golf course/i);
  await courseInput.fill(courseName);

  // Blur the course-suggestions dropdown shut by clicking the already-selected
  // "18 holes" button — a state no-op (the change guard doesn't fire). Do NOT
  // use Escape (closes the whole composer).
  await page.getByRole('button', { name: '18 holes', exact: true }).click();
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
