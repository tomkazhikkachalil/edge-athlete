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

  // Media-first round: native-camera capture buttons headline the composer.
  // (Capture itself can't run headless — the camera is outside the browser;
  // the device pass covers it. Here we pin that the affordances exist.)
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record video' })).toBeVisible();

  // Pick a file — the composer routes every pick through the editor.
  await page.locator('input[type="file"][multiple]').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });

  // A recipe change (aspect chip) arms undo/redo.
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const undoBtn = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  // Undo restored 'free' → the Original chip is the active one again.
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();

  // Re-apply the crop.
  await page.getByRole('button', { name: '1:1', exact: true }).click();

  // Engine round: the Adjust tab renders Light/Color groups over the WebGL
  // preview canvas, and an Exposure drag actually changes rendered pixels
  // (the preview-parity probe — CSS filters could never express exposure).
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
  const previewCanvas = page.locator('canvas[aria-label="Preview"]');
  await expect(previewCanvas).toBeVisible({ timeout: 15_000 });
  const readLuma = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas[aria-label="Preview"]') as HTMLCanvasElement;
      const probe = document.createElement('canvas');
      probe.width = 16;
      probe.height = 16;
      const ctx = probe.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / ((d.length / 4) * 3);
    });
  await page.waitForTimeout(500); // first engine draw is rAF-scheduled
  const neutralLuma = await readLuma();
  expect(neutralLuma).toBeGreaterThan(0); // the engine rendered real pixels
  await page.getByRole('slider', { name: 'Exposure' }).fill('-60');
  await page.waitForTimeout(300); // coalesced uniform redraw
  expect(await readLuma()).toBeLessThan(neutralLuma);
  // The Color group presents its engine sliders too.
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Vibrance' })).toBeVisible();

  // Detail group (blur-pass round): sliders render.
  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Sharpen' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Vignette' })).toBeVisible();

  // Hold-to-compare: while pressed, the stage shows the ORIGINAL — the
  // darkened preview must come back up to the neutral reading.
  const compareBtn = page.getByRole('button', { name: 'Hold to compare with original' });
  await compareBtn.dispatchEvent('pointerdown');
  await page.waitForTimeout(300);
  const comparingLuma = await readLuma();
  expect(Math.abs(comparingLuma - neutralLuma)).toBeLessThan(2); // dither-tolerant
  await compareBtn.dispatchEvent('pointerup');
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeLessThan(neutralLuma); // edit restored

  // Auto-enhance lands as one recipe patch: the Exposure slider moves off
  // the manual −60.
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-enhance' }).click();
  const exposureSlider = page.getByRole('slider', { name: 'Exposure' });
  await expect(exposureSlider).not.toHaveValue('-60');

  // Desktop layout round: the history rail lists labeled steps and jumps
  // to ANY point. (Playwright's 1280px viewport runs the lg: layout.)
  await expect(page.getByRole('list', { name: 'Edit history' })).toBeVisible();
  // The rail row 'Auto enhance' (space) is distinct from the wand button
  // 'Auto-enhance' (hyphen) — deliberate, and load-bearing for this test.
  await expect(page.getByRole('button', { name: 'Auto enhance', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(exposureSlider).toHaveValue('0'); // jumped all the way back
  await page.getByRole('button', { name: 'Auto enhance', exact: true }).click();
  await expect(exposureSlider).not.toHaveValue('0'); // jumped forward again

  // Keyboard: ⌘Z/Ctrl+Z steps back (to the manual −60), redo returns.
  await page.keyboard.press('Control+z');
  await expect(exposureSlider).toHaveValue('-60');
  await page.keyboard.press('Control+Shift+z');
  await expect(exposureSlider).not.toHaveValue('-60');

  // The editor is a real dialog now — ⌘K must NOT open search over it.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0);

  // Export goes through the engine (advanced params force the WebGL path).
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
    .locator('input[type="file"][multiple]')
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
