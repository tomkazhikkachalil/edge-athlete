import path from 'path';
import { test, expect } from '@playwright/test';

// First editor coverage (the editor shipped Jul 26 with zero e2e). Drives the
// real composer: pick a PNG → editor opens → ratio chip (recipe change) →
// undo appears and reverts → Done → tile + re-edit pencil → rehydrated
// editor → dirty-cancel confirm → post publishes with the image.
test('media editor: crop session, undo, re-edit, dirty confirm, publish', async ({ page }) => {
  test.setTimeout(180_000);
  const marker = `Editor smoke ${Date.now()}`;
  const fixture = path.join(__dirname, 'fixtures', 'photo.png');

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const composer = page.getByPlaceholder('Share your thoughts...');
  await expect(composer).toBeVisible();

  // Pick a file — the composer routes every pick through the editor.
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });

  // A recipe change (aspect chip) arms undo/redo.
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  // Undo restored 'free' → the Original chip is the active one again.
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();

  // Re-apply and export.
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });

  // The tile rendered with its re-edit pencil; reopening rehydrates the recipe.
  const editPencil = page.getByRole('button', { name: 'Edit media', exact: true });
  await expect(editPencil).toBeVisible();
  await editPencil.click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });

  // Dirty close asks before discarding; "Keep editing" returns to the editor.
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel editing', exact: true }).click();
  await expect(page.getByText(/discard/i).first()).toBeVisible();
  await page.getByRole('button', { name: /keep editing/i }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });

  // Publish with the edited image and see it land.
  await composer.fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
});
