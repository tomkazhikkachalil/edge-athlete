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

// Multi-clip round reachability: the video tools render and split produces a
// second clip WITHIN the asset. The fixture is recorded in-browser
// (canvas.captureStream + MediaRecorder — also exercises the
// Infinity-duration path). Export itself is NOT asserted: Playwright's
// Chromium lacks h264 encode, so rendering degrades to pass-through by
// design; real encodes are the device pass.
test('video editor: clips/crop/cover tools, frame step, split within the asset', async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto('/feed');
  const hasEncoder = await page.evaluate(() => 'VideoEncoder' in window && 'MediaRecorder' in window);
  test.skip(!hasEncoder, 'WebCodecs/MediaRecorder unavailable in this browser');

  const webm = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise<Blob>(resolve => {
      rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    rec.start();
    const t0 = performance.now();
    await new Promise<void>(resolve => {
      const draw = () => {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360}, 80%, 50%)`;
        ctx.fillRect(0, 0, 320, 240);
        if (t < 3000) requestAnimationFrame(draw);
        else {
          rec.stop();
          resolve();
        }
      };
      draw();
    });
    const blob = await stopped;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  await page.getByRole('button', { name: /what's on your mind/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(webm) });

  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
  // The three video tools.
  await expect(page.getByRole('button', { name: 'Clips', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cover', exact: true })).toBeVisible();
  // Frame stepping present.
  await expect(page.getByRole('button', { name: 'Forward one frame' })).toBeVisible();

  // Scrub to the middle and split — one asset, two clips.
  await expect(page.getByText(/Clip 1\/1/)).toBeVisible({ timeout: 15_000 });
  const timeline = page.getByRole('slider', { name: 'Clip timeline' });
  const box = (await timeline.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const splitBtn = page.getByRole('button', { name: 'Split clip at playhead' });
  await expect(splitBtn).toBeEnabled();
  await splitBtn.click();
  await expect(page.getByText(/Clip \d\/2/)).toBeVisible();

  // Done completes (pass-through here — no h264 in test Chromium) and the
  // composer shows the video tile.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible();
});
