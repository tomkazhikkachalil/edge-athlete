import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { managedProfilePhotoPath, managedProfileSourcePath } from '../src/lib/profiles/photo-paths';

// Profile picture + cover photo (profile quick fixes PR 4, Oct 14 2026): the
// upload buttons show only while a slot is EMPTY; adding a photo goes
// through the one door (Take / Upload / Remove); tapping a photo opens it
// larger with Edit for the owner; Remove brings the upload button back and
// removes our file; Edit profile offers BOTH photos. @mobile: 390 px
// Chromium AND WebKit AND Android. PR 5 (migration 264): the ORIGINAL is kept
// with its crop; Adjust re-renders from it — the render changes, the kept
// original does not, and no second original is written.

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
    const { data: row } = await admin.from('profiles').select('avatar_url, cover_url, avatar_source_url, avatar_recipe, cover_source_url, cover_recipe').eq('id', u.id).single();
    expect(row?.avatar_url).toBeTruthy();
    expect(row?.cover_url).toBeTruthy();
    for (const [url, slot] of [[row!.avatar_url, 'avatar'], [row!.cover_url, 'cover']] as const) {
      const m = managedProfilePhotoPath(url, slot);
      expect(m, `${slot} is a managed path`).not.toBeNull();
      cleanupFiles.push(m!);
    }
    // The kept originals (264): one per slot under profile-sources/{id}/, each with its crop.
    for (const [url, recipe, slot] of [[row!.avatar_source_url, row!.avatar_recipe, 'avatar'], [row!.cover_source_url, row!.cover_recipe, 'cover']] as const) {
      const m = managedProfileSourcePath(url);
      expect(m, `${slot} keeps its original`).not.toBeNull();
      expect(m!.path.startsWith(`profile-sources/${u.id}/`)).toBe(true);
      expect((recipe as { v?: number; recipe?: { kind?: string } } | null)?.recipe?.kind, `${slot} keeps its crop`).toBe('image');
      cleanupFiles.push(m!);
    }
    const listSources = async () => (await admin.storage.from('uploads').list(`profile-sources/${u.id}`)).data?.map(f => f.name) ?? [];
    expect((await listSources()).length).toBe(2);

    // Adjust the picture: the kept original reopens in the crop-only editor; Done
    // re-renders from it — avatar_url changes, avatar_source_url does not, and no
    // second original appears.
    await page.getByRole('button', { name: 'View profile picture', exact: true }).click();
    await page.getByRole('dialog', { name: 'Media viewer' }).getByRole('button', { name: 'Edit photo', exact: true }).click();
    await door.locator('[data-photo-adjust]').click();
    await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    await expect(door).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await admin.from('profiles').select('avatar_url').eq('id', u.id).single()).data?.avatar_url, { timeout: 30_000 }).not.toBe(row!.avatar_url);
    const { data: adjusted } = await admin.from('profiles').select('avatar_url, avatar_source_url, avatar_recipe').eq('id', u.id).single();
    expect(adjusted?.avatar_source_url).toBe(row!.avatar_source_url);
    expect((adjusted?.avatar_recipe as { recipe?: { kind?: string } } | null)?.recipe?.kind).toBe('image');
    cleanupFiles.push(managedProfilePhotoPath(adjusted!.avatar_url, 'avatar')!);
    expect((await listSources()).length).toBe(2);

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
    const { data: after } = await admin.from('profiles').select('avatar_url, avatar_source_url, avatar_recipe').eq('id', u.id).single();
    expect(after?.avatar_url).toBeNull();
    // Remove takes the kept original and its crop with it (264).
    expect(after?.avatar_source_url).toBeNull();
    expect(after?.avatar_recipe).toBeNull();
    expect(await listSources()).toEqual(expect.not.arrayContaining([expect.stringMatching(/^avatar-/)]));

    // Edit profile offers both photos.
    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    // Exact: the cover's corner pencil is "Edit profile" too (Oct 14 2026).
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    const editor = page.getByRole('dialog').filter({ hasText: 'Edit Profile' });
    await expect(editor.getByRole('button', { name: 'Change profile picture', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByRole('button', { name: 'Change cover photo', exact: true })).toBeVisible();
  } finally {
    await ctx.close();
    for (const f of cleanupFiles) await admin.storage.from(f.bucket).remove([f.path]).catch(() => undefined);
    await deleteQaUser(u.id);
  }
});
