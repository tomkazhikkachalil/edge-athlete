import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

// Video posters program, PR 1 (Oct 13 2026): a recorded clip posts with a
// poster, the feed card shows the poster (never a black box), a tap plays it
// in place, and a cover chosen in the editor's Cover step rides the post.

/** A real clip recorded in the browser (the capture-attach recipe). */
async function recordClip(page: Page): Promise<{ name: string; mimeType: string; buffer: Buffer } | null> {
  const canRecord = await page.evaluate(() => 'MediaRecorder' in window);
  if (!canRecord) return null;
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise<Blob>(resolve => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });
    rec.start();
    const t0 = performance.now();
    await new Promise<void>(resolve => {
      const draw = () => {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360}, 80%, 50%)`;
        ctx.fillRect(0, 0, 320, 240);
        if (t < 2500) requestAnimationFrame(draw);
        else {
          rec.stop();
          resolve();
        }
      };
      draw();
    });
    const blob = await stopped;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { data: btoa(s), mime };
  });
  return {
    name: base64.mime === 'video/mp4' ? 'clip.mp4' : 'clip.webm',
    mimeType: base64.mime,
    buffer: Buffer.from(base64.data, 'base64'),
  };
}

test('a recorded clip posts with its poster; the feed card shows the poster and plays on tap @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/feed');
  const clip = await recordClip(page);
  test.skip(!clip, 'MediaRecorder unavailable in this browser');

  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][accept="video/*"]').setInputFiles(clip!);
  // The tile: the local file previews itself, then wears its poster. Scoped
  // to the composer's tile — the feed behind the composer has video cards of
  // its own (production's older posts, poster-less), and an unscoped first()
  // matched one of them (the Oct 13 prod probe).
  const tile = page.locator('[data-media-upload] [data-video-frame]').first();
  await expect(tile).toBeVisible({ timeout: 5_000 });
  await expect(tile).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });

  const marker = `Poster clip ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  const postRequest = page.waitForRequest(r => r.url().includes('/api/posts') && r.method() === 'POST', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  const body = (await postRequest).postDataJSON() as { media?: Array<{ type: string; thumbnailUrl?: string | null }> };
  expect(body.media?.[0]?.type).toBe('video');
  expect(body.media?.[0]?.thumbnailUrl, 'the poster rides the post').toMatch(/^https?:\/\//);
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });

  // The feed card: the poster image, never a black box; the tap plays in place.
  const card = page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const frame = card.locator('[data-video-frame]');
  await expect(frame).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });
  await expect(frame.locator('img')).toHaveAttribute('src', /.+/);
  await expect(frame.locator('video')).toHaveCount(0);
  // PR 6: the blurred placeholder (a ThumbHash of the poster, computed on the device) sits under it.
  await expect(frame.locator('[data-blur-box]')).toHaveCount(1);
  expect(body.media?.[0] && 'blurHash' in body.media[0] ? (body.media[0] as { blurHash?: string }).blurHash : undefined, 'the post carried a blur hash').toMatch(/^[A-Za-z0-9+/]{8,64}={0,2}$/);
  await frame.getByRole('button', { name: 'Play video' }).click();
  await expect(frame).toHaveAttribute('data-video-frame', 'playing');
  await expect(frame.locator('video')).toHaveCount(1);
});

test('a cover chosen in the editor rides the post @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/feed');
  const clip = await recordClip(page);
  test.skip(!clip, 'MediaRecorder unavailable in this browser');

  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles(clip!);
  await page.getByRole('button', { name: 'Edit media', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  // Scrub to the last quarter of the clip and keep it as the cover.
  const timeline = page.getByRole('slider', { name: 'Video timeline' });
  await expect(timeline).toBeVisible({ timeout: 15_000 });
  const box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('[data-media-upload] [data-video-frame]').first()).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });

  const marker = `Cover clip ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  const postRequest = page.waitForRequest(r => r.url().includes('/api/posts') && r.method() === 'POST', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  const body = (await postRequest).postDataJSON() as { media?: Array<{ type: string; thumbnailUrl?: string | null }> };
  expect(body.media?.[0]?.thumbnailUrl, 'the chosen cover rides the post').toMatch(/^https?:\/\//);
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });
  const card = page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('[data-video-frame]')).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });
});

test('a photo from the library as the cover: the tile and the post carry the photo, not a frame @mobile', { tag: '@mobile' }, async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/feed');
  const clip = await recordClip(page);
  test.skip(!clip, 'MediaRecorder unavailable in this browser');
  // The clip is 320×240; the cover is a 2:1 picture made here (the photo.png
  // fixture is 4:3 — the clip's own shape — so it could prove nothing).
  const photoRatio = 2;
  const cover = { name: 'cover.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer() };

  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles(clip!);
  await page.getByRole('button', { name: 'Edit media', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Cover', exact: true }).click();
  await expect(page.locator('[data-cover-source]')).toHaveAttribute('data-cover-source', 'frame');
  await page.locator('[data-cover-photo-input]').setInputFiles(cover);
  await expect(page.locator('[data-cover-source]')).toHaveAttribute('data-cover-source', 'photo');
  await expect(page.locator('[data-cover-use-frame]')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 60_000 });

  // The tile wears the photo (its shape, not the clip's).
  const tile = page.locator('[data-media-upload] [data-video-frame]').first();
  await expect(tile).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });
  await expect.poll(async () => tile.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth / Math.max(1, (img as HTMLImageElement).naturalHeight)), { timeout: 20_000 })
    .toBeCloseTo(photoRatio, 1);

  const marker = `Photo cover ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  const postRequest = page.waitForRequest(r => r.url().includes('/api/posts') && r.method() === 'POST', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  const body = (await postRequest).postDataJSON() as { media?: Array<{ thumbnailUrl?: string | null; editRecipe?: { recipe?: { poster?: unknown } } | null }> };
  expect(body.media?.[0]?.thumbnailUrl).toMatch(/^https?:\/\//);
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });
  const card = page.locator('[data-testid="post-card"]').filter({ hasText: marker }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const frame = card.locator('[data-video-frame]');
  await expect(frame).toHaveAttribute('data-video-frame', 'poster', { timeout: 20_000 });
  await expect.poll(async () => frame.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth / Math.max(1, (img as HTMLImageElement).naturalHeight)), { timeout: 20_000 })
    .toBeCloseTo(photoRatio, 1);
});
