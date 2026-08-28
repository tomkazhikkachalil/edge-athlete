import { test, expect } from '@playwright/test';

/**
 * First-run Get Started checklist (#344) at phone width (Web & Mobile Ship
 * Together). Asserted at 375px — the mobile project runs 390×844, and this
 * card's rows are exactly the kind of layout where those 15px matter.
 *
 * The card gates on account age (<14 days — the per-run QA user is always
 * fresh), the localStorage dismiss key (clean per context: minted storage
 * state carries no origins), and the steps API. The API is STUBBED here so
 * the assertions are about layout and behavior, not about whatever data
 * earlier specs left on the shared QA user; the real endpoint is covered by
 * the desktop prod probes.
 */

const STUBBED_STEPS = {
  hasRound: false,
  hasAvatar: false,
  followingCount: 1,
  hasCompetitive: false,
};

test('@mobile the first-run checklist is usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/profile/getting-started', route =>
    route.fulfill({ json: STUBBED_STEPS })
  );

  await page.goto('/feed');
  const card = page.getByTestId('get-started-card');
  await expect(card).toBeVisible({ timeout: 15_000 });

  // All four steps, with the follow counter interpolated.
  await expect(card.locator('li')).toHaveCount(4);
  await expect(card.getByText('Follow 3 athletes (1/3)')).toBeVisible();

  // Nothing overflows the 375px viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Every CTA holds the 44px touch floor (the polish pass's fix — they were
  // ~20px bare text links).
  for (const name of ['Log a round →', 'Add photo →', 'Find athletes →', 'Set level →']) {
    const box = await card.getByText(name, { exact: true }).boundingBox();
    expect(box, `${name} has a bounding box`).not.toBeNull();
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }

  // Dismiss is a real 40px circle (44 effective via the ea-icon-btn ring) and
  // must not be flex-compressed by the title at this width.
  const dismiss = card.getByRole('button', { name: 'Dismiss get started checklist' });
  const dBox = await dismiss.boundingBox();
  expect(dBox!.width).toBeGreaterThanOrEqual(40);
  expect(dBox!.height).toBeGreaterThanOrEqual(40);

  // "Set level →" deep-links into the Edit Profile modal — the step used to
  // drop users at the top of /athlete with navigation instructions as a hint.
  await card.getByText('Set level →', { exact: true }).click();
  await page.waitForURL('**/athlete?edit=sport', { timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });

  // Back on the feed the card is still offered (not yet dismissed)…
  await page.goto('/feed');
  await expect(card).toBeVisible({ timeout: 15_000 });

  // …and dismissal hides it now and across a reload (localStorage).
  await dismiss.click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: /what's on your mind/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('get-started-card')).toHaveCount(0);
});
