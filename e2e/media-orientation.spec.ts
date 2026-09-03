import path from 'path';
import sharp from 'sharp';
import { test, expect } from '@playwright/test';
import { adminClient } from './helpers/qa-user';
import { parsePublicUrl } from '../src/lib/media/proxy-url';

// Phone-photo orientation (quick-fixes round, Sep 2026). The browser-side
// privacy strip deleted the EXIF APP1 segment — GPS AND the Orientation tag —
// without rotating pixels, so un-edited portraits were stored sideways.
// Fixture: a 400×200 red|blue photo stored sideways (200×400) with
// Orientation=6, the way a phone writes a landscape shot. It goes through
// the composer WITHOUT an edit (the pass-through path that was broken), and
// the STORED object must come back 400×200 with red on the left and no
// orientation tag. sharp resolves from the app's own tree (card.png uses it).

test('an un-edited rotated JPEG is stored upright', async ({ page }) => {
  test.setTimeout(120_000);
  const marker = `Orientation probe ${Date.now()}`;
  const fixture = path.join(__dirname, 'fixtures', 'rotated6.jpg');
  const stored = await sharp(fixture).metadata();
  expect(stored.orientation).toBe(6); // the fixture really is a rotated phone photo
  expect([stored.width, stored.height]).toEqual([200, 400]);

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  const composer = page.getByPlaceholder('Share your thoughts...');
  await expect(composer).toBeVisible();

  await page.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  // No edit → a no-op recipe → the original file is what gets uploaded.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });

  const uploadPromise = page.waitForResponse(
    r => r.url().includes('/api/upload/post-media') && r.request().method() === 'POST',
    { timeout: 60_000 }
  );
  await composer.fill(marker);
  await page.getByRole('button', { name: 'Create Post', exact: true }).click();
  const upload = await uploadPromise;
  expect(upload.ok(), await upload.text()).toBe(true);
  const { url } = (await upload.json()) as { url: string };
  await expect(composer).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });

  const parsed = parsePublicUrl(url);
  expect(parsed).not.toBeNull();
  const admin = adminClient();
  try {
    const { data, error } = await admin.storage.from(parsed!.bucket).download(parsed!.key);
    expect(error, JSON.stringify(error)).toBeNull();
    const bytes = Buffer.from(await data!.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.orientation).toBeUndefined(); // EXIF gone (privacy strip stands)
    expect([meta.width, meta.height]).toEqual([400, 200]); // pixels baked upright
    const px = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * px.info.width + x) * px.info.channels;
      return [px.data[i], px.data[i + 1], px.data[i + 2]];
    };
    const [lr, lg, lb] = at(10, 100);
    const [rr, rg, rb] = at(390, 100);
    expect(lr).toBeGreaterThan(150); expect(lg).toBeLessThan(90); expect(lb).toBeLessThan(90); // red left
    expect(rb).toBeGreaterThan(150); expect(rr).toBeLessThan(90); expect(rg).toBeLessThan(90); // blue right
  } finally {
    // The post (cascade → post_media) and the object.
    const { data: rows } = await admin.from('post_media').select('post_id').eq('media_url', url).limit(1);
    const postId = rows?.[0]?.post_id as string | undefined;
    if (postId) await admin.from('posts').delete().eq('id', postId);
    await admin.storage.from(parsed!.bucket).remove([parsed!.key]);
  }
});
