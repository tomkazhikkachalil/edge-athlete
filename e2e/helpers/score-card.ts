import { expect, type Locator, type Page } from '@playwright/test';

// The live scoring card (Tom's live-round spec, Nov 25 2026). The card has
// no "Hole N media" or "Hole N of M" line any more: the hole on the card is
// the number on its plate.

export const scoreCard = (page: Page): Locator => page.locator('[data-score-card]');

/** The scorer is open on hole `n` (the hole NUMBER on the plate). */
export async function expectScorerOnHole(page: Page, n: number, timeout = 15_000): Promise<void> {
  await expect(scoreCard(page).locator('[data-hole-number]')).toHaveText(String(n), { timeout });
}

/** The scorer is not on screen. */
export async function expectScorerClosed(page: Page, timeout = 15_000): Promise<void> {
  await expect(scoreCard(page)).toHaveCount(0, { timeout });
}

/** The map preview on the hole plate: it saves the hole, closes the card and opens the map on it. */
export const mapPreview = (page: Page): Locator => scoreCard(page).locator('[data-hole-thumb]');

/** The strokes dial, as assistive tech sees it. */
export const strokesDial = (page: Page): Locator => scoreCard(page).getByRole('slider', { name: 'Strokes' });

/** Type a digit on the dial: the score is set (and the hole recorded). */
export async function typeStrokes(page: Page, digit: string): Promise<void> {
  const dial = strokesDial(page);
  await dial.focus();
  await dial.press(digit);
  await expect(dial).toHaveAttribute('aria-valuenow', digit);
}

export const nextHole = (page: Page): Locator => scoreCard(page).locator('[data-scorer-next]');
export const previousHole = (page: Page): Locator => scoreCard(page).locator('[data-scorer-previous]');
