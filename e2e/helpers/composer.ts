import { expect, type Locator, type Page } from '@playwright/test';

// The General post composer (Tom's spec, Nov 26 2026): one page, and posting
// is a SLIDE — a key in a track, not a button to tap. A pointer's click on
// the key does nothing by design; a walk that only needs the post made uses
// the key's keyboard path (`slidePost`), the gesture itself is `dragSlide`
// (helpers/go-live.ts) over `[data-compose-footer]`.

/** The caption's placeholder (C4). */
export const CAPTION = 'Share your thoughts';
export const captionField = (page: Page): Locator => page.getByPlaceholder(CAPTION, { exact: true });

/** The composer's footer: the eye key and the slide. */
export const composeFooter = (page: Page): Locator => page.locator('[data-compose-footer]');
export const postSlide = (page: Page): Locator => composeFooter(page).locator('[data-slide-key]');

/** Post through the slide's keyboard path. Waits for the slide to be ready:
 *  while a file uploads it reads "Uploading" and does not move (X2). */
export async function slidePost(page: Page): Promise<void> {
  const key = postSlide(page);
  await expect(key).toHaveAttribute('aria-label', 'Slide to post');
  await expect(key).not.toHaveAttribute('aria-disabled', 'true', { timeout: 60_000 });
  await key.focus();
  await key.press('Enter');
}

/** The media strip's thumbnails, in order (the first is the cover). */
export const thumbs = (page: Page): Locator => page.locator('[data-compose-thumb]');

/** Select thumbnail `index` (its edit keys appear under the strip). */
export async function selectThumb(page: Page, index = 0): Promise<void> {
  const thumb = thumbs(page).nth(index);
  if ((await thumb.getAttribute('data-compose-thumb')) !== 'selected') await thumb.locator('[data-compose-select]').click();
  await expect(thumb).toHaveAttribute('data-compose-thumb', 'selected');
}

/** Open the editor on thumbnail `index`: Crop for a photo, Edit for a video. */
export async function openThumbEditor(page: Page, index = 0): Promise<void> {
  await selectThumb(page, index);
  await page.locator('[data-compose-edit-key="crop"], [data-compose-edit-key="edit"]').click();
}
