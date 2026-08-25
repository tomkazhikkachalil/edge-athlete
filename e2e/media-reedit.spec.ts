import path from 'path';
import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// Non-destructive re-edit (migration 120): publish a post with an edited
// image, reopen it via Edit Post → Media pencil, re-render — the SAME
// post_media row gets a new media_url while source_url preserves the
// original. Skips until 120 is applied (org-spec probe pattern).
test('media re-edit after publish: new render, original preserved on the same row', async ({ page }) => {
  test.setTimeout(180_000);
  const userA = loadQaUser('user.json');
  const admin = adminClient();

  const probe = await admin.from('post_media').select('source_url').limit(1);
  test.skip(!!probe.error, `post_media.source_url missing — run migration 120 (${probe.error?.message})`);

  const marker = `Reedit smoke ${Date.now()}`;
  const fixture = path.join(__dirname, 'fixtures', 'photo.png');

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const composer = page.getByPlaceholder('Share your thoughts...');
  await expect(composer).toBeVisible();

  // Publish with an EDITED image (ratio chip = real edit → original kept).
  await page.locator('input[type="file"]').first().setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await composer.fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });

  // The row landed non-destructively: recipe + original alongside the render.
  const { data: postRow } = await admin
    .from('posts')
    .select('id')
    .eq('profile_id', userA.id)
    .eq('caption', marker)
    .maybeSingle();
  expect(postRow, 'published post row').toBeTruthy();
  const { data: before } = await admin
    .from('post_media')
    .select('id, media_url, source_url, edit_recipe')
    .eq('post_id', postRow!.id)
    .maybeSingle();
  expect(before, 'post_media row').toBeTruthy();
  expect(before!.source_url, 'original uploaded alongside the render').toBeTruthy();
  expect(before!.edit_recipe, 'recipe persisted').toBeTruthy();

  // Re-edit via Edit Post → Media pencil. The Edit button renders only on
  // OWN posts, and this fresh QA user owns exactly one.
  await page.getByRole('button', { name: 'Edit post' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit Post' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit media', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Media updated').first()).toBeVisible({ timeout: 30_000 });

  // Same row, new render, original untouched.
  const { data: after } = await admin
    .from('post_media')
    .select('id, media_url, source_url')
    .eq('post_id', postRow!.id)
    .maybeSingle();
  expect(after!.id).toBe(before!.id);
  expect(after!.media_url).not.toBe(before!.media_url);
  expect(after!.source_url).toBe(before!.source_url);
});
