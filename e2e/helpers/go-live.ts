import { expect, type Locator, type Page } from '@playwright/test';

// Go Live is a slide (golf part 2, Nov 24 2026): the Start step's finish is
// a key in a track, not a button to tap. A pointer's click on the key does
// nothing by design — a walk that only needs the round started uses the
// key's keyboard path; the gesture itself is `slideToGoLive`.

/** The slide's key on the round's last step. */
export const slideKey = (flow: Locator) => flow.locator('[data-slide-key]');

/** Start the round through the key's keyboard path (Enter). */
export async function goLive(flow: Locator): Promise<void> {
  const key = slideKey(flow);
  await expect(key).toHaveAttribute('aria-label', 'Slide to go live');
  await key.focus();
  await key.press('Enter');
}

/** Drag the key `fraction` of the way along its track and let go (1 = the end).
 *  Moves in steps: a single jump is not a drag a pointer handler sees. */
export async function dragSlide(page: Page, flow: Locator, fraction: number): Promise<void> {
  const key = slideKey(flow);
  const track = flow.locator('[data-slide-track]');
  const k = (await key.boundingBox())!;
  const t = (await track.boundingBox())!;
  const travel = t.width - 56;
  const startX = k.x + k.width / 2;
  const y = k.y + k.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + travel * fraction, y, { steps: 12 });
  await page.mouse.up();
}
