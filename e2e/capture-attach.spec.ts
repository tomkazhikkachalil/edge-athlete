import path from 'path';
import { test, expect } from '@playwright/test';

// Capture v2 (Sep 3 2026): a CAMERA capture attaches immediately as a tile —
// no editor between the camera's hand-back and the tile. Headless cannot run
// a camera, but CaptureInputs' capture inputs are the camera's hand-back
// minus the camera. Library picks keep the editor-first flow (asserted too).
test('a camera photo attaches as a tile at once; Edit is one tap away @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = path.join(__dirname, 'fixtures', 'photo.png');

  await page.goto('/feed');
  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();

  // The photo CAPTURE input (single-file, accept=image/*) — not the library one.
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(fixture);
  const editTile = page.getByRole('button', { name: 'Edit media', exact: true });
  await expect(editTile).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);

  // The editor is still there when wanted.
  await editTile.click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(editTile).toBeVisible();

  // Library picks are unchanged: editor first.
  await page.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(2);
});

test('a camera video attaches as a tile at once and posts @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/feed');
  const canRecord = await page.evaluate(() => 'MediaRecorder' in window);
  test.skip(!canRecord, 'MediaRecorder unavailable in this browser');

  // A real clip, recorded in-browser (canvas.captureStream + MediaRecorder —
  // also the Infinity-duration case MediaRecorder files present).
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

  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][accept="video/*"]').setInputFiles({
    name: base64.mime === 'video/mp4' ? 'clip.mp4' : 'clip.webm',
    mimeType: base64.mime,
    buffer: Buffer.from(base64.data, 'base64'),
  });

  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);
  await expect(page.locator('[role="status"]').filter({ hasText: 'Too long' })).toHaveCount(0);

  const marker = `Capture v2 clip ${Date.now()}`;
  await page.getByPlaceholder('Share your thoughts...').fill(marker);
  // At 390px the nav drawer ALSO carries a "Create Post" button — the composer's is last.
  await page.getByRole('button', { name: 'Create Post', exact: true }).last().click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 30_000 });
});
