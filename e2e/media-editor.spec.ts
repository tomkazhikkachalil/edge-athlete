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

  // E3a: the story ratio is offered, and flip is a real crop-tab control
  // (the cropper swaps to a derived flipped preview; export flips innermost
  // so crop coords stay valid).
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Flip horizontally' }).click();
  await page.waitForTimeout(700); // flipped preview URL minting

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
  // Luma VARIANCE of a 1:1 center crop — the probe for zero-mean effects
  // (grain adds variance, background blur removes it); scaling down would
  // average both away.
  const readVariance = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas[aria-label="Preview"]') as HTMLCanvasElement;
      const probe = document.createElement('canvas');
      probe.width = 48;
      probe.height = 48;
      const ctx = probe.getContext('2d')!;
      const sx = Math.max(0, Math.floor((canvas.width - 48) / 2));
      const sy = Math.max(0, Math.floor((canvas.height - 48) / 2));
      ctx.drawImage(canvas, sx, sy, 48, 48, 0, 0, 48, 48);
      const d = ctx.getImageData(0, 0, 48, 48).data;
      const lumas: number[] = [];
      for (let i = 0; i < d.length; i += 4) lumas.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
      return lumas.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lumas.length;
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

  // Color mixer (Phase 2 E4a): the fixture is aqua-heavy, so Aqua
  // luminance −100 must darken the stage through the LUT stage.
  await page.getByRole('button', { name: 'Mix', exact: true }).click();
  await page.getByRole('button', { name: 'Aqua', exact: true }).click();
  const preMixLuma = await readLuma();
  await page.getByRole('slider', { name: 'Luminance' }).fill('-100');
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeLessThan(preMixLuma);

  // Tone curves (Phase 2 E4b): pressing high in the editor's left half adds
  // a shadow-lifting point — the stage must brighten through the curve LUT.
  await page.getByRole('button', { name: 'Curves', exact: true }).click();
  const curveBox = (await page.getByRole('application', { name: 'Tone curve' }).boundingBox())!;
  const preCurveLuma = await readLuma();
  await page.mouse.move(curveBox.x + curveBox.width * 0.3, curveBox.y + curveBox.height * 0.2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeGreaterThan(preCurveLuma);
  // The point registered in the editor (2 endpoints + the new one).
  await expect(page.getByRole('button', { name: 'Curve point 3' })).toBeVisible();

  // Local masks (Phase 2 E4c): add a radial, lift its exposure — the
  // center-weighted mask must brighten the stage, and its outline renders.
  await page.getByRole('button', { name: 'Masks', exact: true }).click();
  await page.getByRole('button', { name: '+ Radial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Radial mask 1' })).toBeVisible();
  const preMaskLuma = await readLuma();
  await page.getByRole('slider', { name: 'Exposure' }).fill('80');
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeGreaterThan(preMaskLuma);

  // Background blur (E4e): the center-covering mask at full blur must
  // smooth the center crop — variance drops.
  const preBlurVariance = await readVariance();
  await page.getByRole('slider', { name: 'Blur', exact: true }).fill('100');
  await page.waitForTimeout(300);
  expect(await readVariance()).toBeLessThan(preBlurVariance);
  await page.getByRole('slider', { name: 'Blur', exact: true }).fill('0');

  // Brush masks (E4f): paint a stroke across the stage, lift its exposure
  // — the painted corridor must brighten the mean reading. Then remove it
  // so the rest of the flow sees stable state.
  await page.getByRole('button', { name: '+ Brush', exact: true }).click();
  const overlayBox = (await page.locator('[aria-label="Mask overlay"]').boundingBox())!;
  await page.mouse.move(overlayBox.x + overlayBox.width * 0.25, overlayBox.y + overlayBox.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      overlayBox.x + overlayBox.width * (0.25 + i * 0.08),
      overlayBox.y + overlayBox.height * 0.5
    );
  }
  await page.mouse.up();
  const prePaintLuma = await readLuma();
  await page.getByRole('slider', { name: 'Exposure' }).fill('90');
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeGreaterThan(prePaintLuma + 0.5);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  // Clone stamp (E4g): a tap drops a heal spot (source offset right) —
  // cloning a different-colored region must shift the mean reading, and
  // both handles render.
  await page.getByRole('button', { name: 'Retouch', exact: true }).click();
  const retouchBox = (await page.locator('[aria-label="Retouch overlay"]').boundingBox())!;
  const preCloneLuma = await readLuma();
  await page.mouse.click(
    retouchBox.x + retouchBox.width * 0.35,
    retouchBox.y + retouchBox.height * 0.5
  );
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: 'Retouch spot 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retouch source 1' })).toBeVisible();
  expect(Math.abs((await readLuma()) - preCloneLuma)).toBeGreaterThan(0.3);
  // The selected spot's Size slider tunes it.
  await page.getByRole('slider', { name: 'Size', exact: true }).fill('40');

  // Text & stickers (E4h): add big white text + an emoji sticker. The
  // PREVIEW overlay is DOM (not the engine canvas), so the pixel proof of
  // the export happens on the rendered tile after Done, below.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Overlay 1' })).toBeVisible();
  const textInput = page.getByRole('textbox', { name: 'Overlay text' });
  await textInput.fill('GO');
  await page.getByRole('slider', { name: 'Size', exact: true }).fill('95');
  await page.getByRole('button', { name: '+ Sticker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Overlay 2' })).toBeVisible();

  // Hold-to-compare: while pressed, the stage shows the ORIGINAL — the
  // darkened preview must come back up to the neutral reading.
  const compareBtn = page.getByRole('button', { name: 'Hold to compare with original' });
  await compareBtn.dispatchEvent('pointerdown');
  await page.waitForTimeout(300);
  const comparingLuma = await readLuma();
  expect(Math.abs(comparingLuma - neutralLuma)).toBeLessThan(2); // dither-tolerant
  await compareBtn.dispatchEvent('pointerup');
  await page.waitForTimeout(300);
  // Edit restored: clearly different from the original (direction depends
  // on the accumulated edits — exposure darkens, the curve lift brightens).
  expect(Math.abs((await readLuma()) - neutralLuma)).toBeGreaterThan(2);

  // Auto-enhance lands as one recipe patch: the Exposure slider moves off
  // the manual −60. (Back to the Adjust tool first — the Masks block left
  // the editor on its own tool.)
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
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

  // White-balance eyedropper (Phase 2 E4d): arm it, tap the (colorful)
  // stage — the Temperature slider must move off neutral.
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  await page.getByRole('button', { name: 'Pick white balance' }).click();
  const wbTarget = page.getByRole('button', { name: 'Sample white balance from the photo' });
  await expect(wbTarget).toBeVisible();
  await wbTarget.click();
  await expect(page.getByRole('slider', { name: 'Temperature' })).not.toHaveValue('0');

  // Grain (E4d): variance-probe — zero-mean noise won't move the mean, so
  // measure luma variance instead.
  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  const preGrainVariance = await readVariance();
  await page.getByRole('slider', { name: 'Grain', exact: true }).fill('100');
  await page.waitForTimeout(300);
  expect(await readVariance()).toBeGreaterThan(preGrainVariance);
  // Take grain back off so the remaining assertions see stable pixels.
  await page.getByRole('slider', { name: 'Grain', exact: true }).fill('0');

  // Film pack (E3a): selecting a film look arms the intensity slider.
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: /Gold/ }).click();
  const intensity = page.getByRole('slider', { name: 'Intensity' });
  await expect(intensity).toBeVisible();
  await intensity.fill('50');

  // Perspective (E3b): the keystone warp runs live on the engine stage —
  // a vertical correction blacks out an edge, dropping the mean reading.
  await page.getByRole('button', { name: 'Perspective', exact: true }).click();
  await page.waitForTimeout(300);
  const preWarpLuma = await readLuma();
  await page.getByRole('slider', { name: 'Vertical', exact: true }).fill('60');
  await page.waitForTimeout(300);
  expect(await readLuma()).toBeLessThan(preWarpLuma);

  // Export goes through the engine (advanced params force the WebGL path).
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });

  // E4h export proof: the rendered tile must contain the big pure-white
  // 'GO' glyphs — count near-white pixels in the exported blob (the DOM
  // preview never touches the canvas, so this is the only pixel check
  // that exercises drawOverlays + the bundled fonts).
  const whitePixels = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')].filter(el =>
      el.src.startsWith('blob:')
    ) as HTMLImageElement[];
    const tile = imgs.sort(
      (a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight
    )[0];
    if (!tile) return -1;
    await tile.decode();
    const canvas = document.createElement('canvas');
    canvas.width = tile.naturalWidth;
    canvas.height = tile.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(tile, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) count++;
    }
    return count;
  });
  expect(whitePixels).toBeGreaterThan(200);

  // The tile rendered with its re-edit pencil; reopening rehydrates the recipe.
  const editPencil = page.getByRole('button', { name: 'Edit media', exact: true });
  await expect(editPencil).toBeVisible();
  await editPencil.click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });

  // Overlays rehydrated: the Text tool lists both, content intact.
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.getByRole('button', { name: 'GO', exact: true })).toBeVisible();
  // .first(): the history rail also has a 'Crop' row; the tool tab
  // precedes the rail in DOM order.
  await page.getByRole('button', { name: 'Crop', exact: true }).first().click();

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
