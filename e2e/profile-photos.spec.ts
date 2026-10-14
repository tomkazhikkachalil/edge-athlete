import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { managedProfilePhotoPath } from '../src/lib/profiles/photo-paths';

// Profile picture + cover photo (profile quick fixes PR 4, Oct 14 2026): the
// upload buttons show only while a slot is EMPTY; adding a photo goes
// through the one door (Take / Upload / Remove); tapping a photo opens it
// larger with Edit for the owner; Remove brings the upload button back and
// removes our file; Edit profile offers BOTH photos. @mobile: 390 px
// Chromium AND WebKit AND Android.

const PHOTO = join(process.cwd(), 'e2e', 'fixtures', 'photo.png');

test('photos: add both through the door, the buttons go, tap → viewer → Edit → Remove brings them back @mobile', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const u = await createQaUser({ displayName: 'Photo Pia', firstName: 'Photo', lastName: 'Pia' });
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const cleanupFiles: Array<{ bucket: string; path: string }> = [];
  try {
    const page = await ctx.newPage();
    await page.goto('/athlete');
    // Empty slots: both upload buttons, no photo to tap.
    const addAvatar = page.getByRole('button', { name: 'Add profile picture', exact: true });
    const addCover = page.getByRole('button', { name: 'Add cover photo', exact: true });
    await expect(addAvatar).toBeVisible({ timeout: 30_000 });
    await expect(addCover).toBeVisible();
    await expect(page.getByRole('button', { name: 'View profile picture', exact: true })).toHaveCount(0);

    // The picture through the door: Upload a new photo → the crop-only editor → Done.
    await addAvatar.click();
    const door = page.locator('[data-photo-door="avatar"]');
    await expect(door.getByRole('dialog')).toBeVisible();
    await expect(door.locator('[data-photo-remove]')).toHaveCount(0); // nothing to remove yet
    await door.locator('input[aria-label="Choose a profile photo"]').setInputFiles(PHOTO);
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    await expect(addAvatar).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-profile-avatar] img')).toBeVisible();

    // The cover the same way.
    await addCover.click();
    const coverDoor = page.locator('[data-photo-door="cover"]');
    await coverDoor.locator('input[aria-label="Choose a cover photo"]').setInputFiles(PHOTO);
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    await expect(addCover).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('[data-profile-cover="photo"]')).toBeVisible();
    const { data: row } = await admin.from('profiles').select('avatar_url, cover_url').eq('id', u.id).single();
    expect(row?.avatar_url).toBeTruthy();
    expect(row?.cover_url).toBeTruthy();
    for (const [url, slot] of [[row!.avatar_url, 'avatar'], [row!.cover_url, 'cover']] as const) {
      const m = managedProfilePhotoPath(url, slot);
      expect(m, `${slot} is a managed path`).not.toBeNull();
      cleanupFiles.push(m!);
    }

    // Tap the picture → the viewer (one photo, no counter) → Edit → Remove → confirm.
    await page.getByRole('button', { name: 'View profile picture', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('1 / 1')).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click();
    await door.locator('[data-photo-remove]').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Remove profile picture?' });
    await expect(confirm).toContainText('This cannot be undone');
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(addAvatar).toBeVisible({ timeout: 30_000 });
    const { data: after } = await admin.from('profiles').select('avatar_url').eq('id', u.id).single();
    expect(after?.avatar_url).toBeNull();

    // Edit profile offers both photos.
    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    await page.getByRole('button', { name: 'Edit Profile' }).click();
    const editor = page.getByRole('dialog').filter({ hasText: 'Edit Profile' });
    await expect(editor.getByRole('button', { name: 'Change profile picture', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByRole('button', { name: 'Change cover photo', exact: true })).toBeVisible();
  } finally {
    await ctx.close();
    for (const f of cleanupFiles) await admin.storage.from(f.bucket).remove([f.path]).catch(() => undefined);
    await deleteQaUser(u.id);
  }
});
