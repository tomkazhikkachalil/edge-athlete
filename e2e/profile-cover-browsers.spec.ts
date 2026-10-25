import { test, expect, type Page, type Request } from './helpers/test';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { adminClient, bypassHeaders, createQaUser, deleteQaUser, mintStorageState } from './helpers/qa-user';
import { managedProfilePhotoPath, managedProfileSourcePath } from '../src/lib/profiles/photo-paths';

// CHANGING a cover photo, the way a phone does it (every-browser round, Oct 16
// 2026 — a Brave Android user could not change the background of their
// profile). profile-photos.spec adds a first cover by dropping a file into the
// hidden input; a person TAPS "Upload a new photo", which opens the file
// chooser through input.click(). Both doors are walked here, over a cover that
// already exists:
//   the profile: tap the cover → Edit photo → Upload a new photo (immediate)
//   Edit Profile: Change cover photo → Upload a new photo → Save (deferred)
// Each upload's body stays under Vercel's 4.5 MB cap (a local server has no
// cap, so it is measured here), the header shows the NEW photo, loaded, on
// /athlete/[id] and /u/[handle]. @mobile: every phone project, Brave included.

const PHOTO = join(process.cwd(), 'e2e', 'fixtures', 'photo.png');
const VERCEL_BODY_CAP = 4.5 * 1024 * 1024;

/** A 2000 × 1400 photo-like PNG (noise compresses badly): ~8 MB, under the 10 MB pick limit, kept as-is as the original. */
async function bigPng(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const w = 2000;
  const h = 1400;
  const raw = randomBytes(w * h * 3);
  return { name: 'big-cover.png', mimeType: 'image/png', buffer: await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer() };
}

/** The body's size as sent: Content-Length (Chromium does not hand a file body to postDataBuffer). */
const bodyBytes = async (req: Request) => Number((await req.allHeaders())['content-length'] ?? req.postDataBuffer()?.length ?? 0);

/** The header's cover, loaded: its src and natural width. */
async function coverShown(page: Page) {
  const img = page.locator('[data-profile-cover="photo"] img');
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  return img.getAttribute('src');
}

test('change an existing cover from the profile and from Edit Profile, by tapping; the header shows it on both routes @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const u = await createQaUser({ displayName: 'Cover Cleo', firstName: 'Cover', lastName: 'Cleo' });
  const handle = `edgeqa-${u.id.slice(0, 8)}`;
  await admin.from('profiles').update({ handle, visibility: 'public' }).eq('id', u.id);
  const ctx = await browser.newContext({ storageState: await mintStorageState(u), extraHTTPHeaders: bypassHeaders() });
  const kept = new Set<string>();
  const keep = (row: { cover_url?: string | null; cover_source_url?: string | null } | null) => {
    const a = row?.cover_url ? managedProfilePhotoPath(row.cover_url, 'cover') : null;
    const b = row?.cover_source_url ? managedProfileSourcePath(row.cover_source_url) : null;
    for (const m of [a, b]) if (m) kept.add(`${m.bucket}\n${m.path}`);
  };
  const coverRow = async () => (await admin.from('profiles').select('cover_url, cover_source_url').eq('id', u.id).single()).data;
  try {
    const page = await ctx.newPage();
    const uploads: Array<Promise<number>> = [];
    page.on('request', r => { if (r.url().includes('/api/upload/cover') && r.method() === 'POST') uploads.push(bodyBytes(r)); });

    // A first cover — through Edit Profile (Convention 52: no upload button on
    // the profile) — so every step below CHANGES one. /athlete/[id] of one's
    // own id lands on /athlete.
    await page.goto(`/athlete/${u.id}`);
    await expect(page.getByRole('button', { name: 'Add cover photo', exact: true })).toHaveCount(0);
    await page.locator('[data-profile-cover] [data-profile-edit]').click({ timeout: 30_000 });
    const editor0 = page.getByRole('dialog', { name: 'Edit Profile', exact: true });
    await editor0.getByRole('button', { name: 'Change cover photo', exact: true }).click({ timeout: 30_000 });
    const door = page.locator('[data-photo-door="cover"]');
    let chooser = page.waitForEvent('filechooser');
    await door.locator('[data-photo-upload]').click();
    await (await chooser).setFiles(PHOTO);
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    await expect(editor0.getByAltText('New cover photo')).toBeVisible({ timeout: 30_000 });
    const saved0 = page.waitForResponse(r => r.url().includes('/api/upload/cover') && r.request().method() === 'POST', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Save Basic' }).click();
    expect((await saved0).status(), 'the first cover uploads').toBe(200);
    await expect(editor0).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('[data-profile-cover="photo"]')).toBeVisible({ timeout: 30_000 });
    const first = await coverRow();
    expect(first?.cover_url, 'the first cover saved').toBeTruthy();
    keep(first);
    const firstSrc = await coverShown(page);

    // 1. The profile door: tap the cover → Edit photo → Upload a new photo.
    // A tap on the cover's open upper-left — its centre is under the profile
    // picture that straddles it (and, scrolled, under the sticky header).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'View cover photo', exact: true }).click({ position: { x: 24, y: 24 } });
    await page.getByRole('dialog', { name: 'Media viewer' }).getByRole('button', { name: 'Edit photo', exact: true }).click();
    chooser = page.waitForEvent('filechooser');
    await door.locator('[data-photo-upload]').click();
    await (await chooser).setFiles(await bigPng());
    await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 30_000 });
    const saved1 = page.waitForResponse(r => r.url().includes('/api/upload/cover') && r.request().method() === 'POST', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    expect((await saved1).status(), 'the changed cover uploads').toBe(200);
    const second = await coverRow();
    expect(second?.cover_url).not.toBe(first?.cover_url);
    keep(second);
    await expect.poll(() => coverShown(page), { timeout: 30_000 }).not.toBe(firstSrc);
    const secondSrc = await coverShown(page);

    // 2. Edit Profile: Change cover photo → Upload a new photo → the preview → Save.
    await page.goto('/athlete');
    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Profile', exact: true });
    await editor.getByRole('button', { name: 'Change cover photo', exact: true }).click({ timeout: 30_000 });
    chooser = page.waitForEvent('filechooser');
    await door.locator('[data-photo-upload]').click();
    await (await chooser).setFiles(await bigPng());
    await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 30_000 });
    await expect(editor.getByAltText('New cover photo')).toBeVisible({ timeout: 30_000 });
    const saved2 = page.waitForResponse(r => r.url().includes('/api/upload/cover') && r.request().method() === 'POST', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Save Basic' }).click();
    expect((await saved2).status(), 'the cover saved with the profile').toBe(200);
    const third = await coverRow();
    expect(third?.cover_url).not.toBe(second?.cover_url);
    keep(third);

    // Every upload fits a Vercel request.
    expect(uploads.length).toBe(3);
    for (const b of await Promise.all(uploads)) expect(b, `an upload body of ${(b / 1048576).toFixed(1)} MB`).toBeLessThan(VERCEL_BODY_CAP);

    // Both routes show the newest cover, loaded.
    await page.goto(`/athlete/${u.id}`);
    const onAthlete = await coverShown(page);
    expect(onAthlete).not.toBe(secondSrc);
    await page.goto(`/u/${handle}`);
    expect(await coverShown(page)).toBeTruthy();
  } finally {
    await ctx.close();
    for (const k of kept) {
      const [bucket, path] = k.split('\n');
      await admin.storage.from(bucket).remove([path]).catch(() => undefined);
    }
    await deleteQaUser(u.id);
  }
});
