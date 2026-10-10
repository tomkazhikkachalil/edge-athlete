import path from 'path';
import { test, expect, type Page } from '@playwright/test';

// The hands-on crop (Oct 2026): the person shapes the crop box itself —
// corners, edges, a drag inside, two fingers — to ANY area, where the editor
// used to offer only the ratio chips. These drive the real composer editor
// with the fixture photo (320×240) and read the box the stage reports
// (`data-crop-rect`, in source pixels) and, at the end, the exported file.
//
// The same body runs at desktop width and, tagged @mobile, at phone width on
// Chromium AND WebKit (every iPhone browser is WebKit).

const FIXTURE = path.join(__dirname, 'fixtures', 'photo.png');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function rectOf(page: Page): Promise<Rect> {
  const raw = await page.locator('[data-crop-box]').getAttribute('data-crop-rect');
  const [x, y, width, height] = (raw ?? '').split(',').map(Number);
  return { x, y, width, height };
}

/** Drag a handle by a fraction of the crop box's on-screen size. */
async function drag(page: Page, handle: string, fx: number, fy: number): Promise<void> {
  const box = (await page.locator('[data-crop-box]').boundingBox())!;
  const grip = (await page.locator(`[data-crop-handle="${handle}"]`).boundingBox())!;
  const startX = grip.x + grip.width / 2;
  const startY = grip.y + grip.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX + (box.width * fx * i) / 6, startY + (box.height * fy * i) / 6);
  }
  await page.mouse.up();
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles(FIXTURE);
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-crop-box]')).toBeVisible({ timeout: 15_000 });
}

async function customCrop(page: Page): Promise<void> {
  await openEditor(page);

  // Untouched: the box is the whole photo and the stage says what to do.
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  await expect(page.locator('[data-crop-readout]')).toHaveText('Drag the corners or edges to crop');
  await expect(page.getByRole('button', { name: 'Free', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  // A corner: both sides follow the finger — a shape no chip offers.
  await drag(page, 'se', -0.25, -0.4);
  const corner = await rectOf(page);
  expect(corner.x).toBe(0);
  expect(corner.y).toBe(0);
  expect(Math.abs(corner.width - 240)).toBeLessThanOrEqual(4);
  expect(Math.abs(corner.height - 144)).toBeLessThanOrEqual(4);
  await expect(page.locator('[data-crop-readout]')).toHaveText(
    `${corner.width} × ${corner.height}`
  );

  // An edge: one side only.
  await drag(page, 'w', 0.25, 0);
  const edge = await rectOf(page);
  expect(edge.x).toBeGreaterThan(40);
  expect(edge.y).toBe(0);
  expect(edge.height).toBe(corner.height);
  expect(edge.x + edge.width).toBe(corner.width);

  // Inside: the box moves whole.
  await drag(page, 'move', 0.2, 0.3);
  const moved = await rectOf(page);
  expect(moved.width).toBe(edge.width);
  expect(moved.height).toBe(edge.height);
  expect(moved.x).toBeGreaterThan(edge.x);
  expect(moved.y).toBeGreaterThan(edge.y);

  // One gesture is one undo step: Undo takes back the move, nothing more.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await rectOf(page)).toEqual(edge);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await rectOf(page)).toEqual(moved);

  // Two fingers scale the box about its centre and keep its shape.
  await page.evaluate(() => {
    const stage = document.querySelector('[data-crop-stage]')!;
    const box = document.querySelector('[data-crop-box]')!.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const fire = (type: string, id: number, x: number, y: number) => {
      const target = type === 'pointerdown' ? (document.elementFromPoint(x, y) ?? stage) : stage;
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: 'touch',
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          button: 0,
        })
      );
    };
    fire('pointerdown', 11, cx - 20, cy);
    fire('pointerdown', 12, cx + 20, cy);
    for (let i = 1; i <= 5; i++) fire('pointermove', 12, cx + 20 - i * 2, cy); // 40px → 30px
    fire('pointerup', 12, cx + 10, cy);
    fire('pointerup', 11, cx - 20, cy);
  });
  await expect
    .poll(async () => (await rectOf(page)).width, { timeout: 5_000 })
    .toBeLessThan(moved.width);
  const pinched = await rectOf(page);
  expect(Math.abs(pinched.width - moved.width * 0.75)).toBeLessThanOrEqual(3);
  expect(Math.abs(pinched.width / pinched.height - moved.width / moved.height)).toBeLessThan(0.06);

  // The keyboard reaches every handle: an arrow nudges the focused one.
  await page.getByRole('button', { name: 'Crop corner, bottom right' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await rectOf(page)).width).toBeLessThan(pinched.width);

  // A ratio chip is a shortcut: the box snaps to it and keeps it when resized…
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const square = await rectOf(page);
  expect(Math.abs(square.width - square.height)).toBeLessThanOrEqual(1);
  await drag(page, 'nw', 0.2, 0.05);
  const smaller = await rectOf(page);
  expect(smaller.width).toBeLessThan(square.width);
  expect(Math.abs(smaller.width - smaller.height)).toBeLessThanOrEqual(1);

  // …and "Free" hands the shape back.
  await page.getByRole('button', { name: 'Free', exact: true }).click();
  await drag(page, 'n', 0, 0.3);
  const freed = await rectOf(page);
  expect(freed.width).toBe(smaller.width);
  expect(freed.height).toBeLessThan(smaller.height - 10);

  // The file that comes out is exactly the box.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeHidden({ timeout: 30_000 });
  const exported = await page.evaluate(async () => {
    const tiles = [...document.querySelectorAll('img')].filter(el =>
      el.src.startsWith('blob:')
    ) as HTMLImageElement[];
    const tile = tiles[0];
    if (!tile) return null;
    await tile.decode();
    return { width: tile.naturalWidth, height: tile.naturalHeight };
  });
  expect(exported).toEqual({ width: freed.width, height: freed.height });

  // Reopened, the editor shows the same box (the recipe carried it).
  await page.getByRole('button', { name: 'Edit media', exact: true }).click();
  await expect(page.locator('[data-crop-box]')).toBeVisible({ timeout: 20_000 });
  expect(await rectOf(page)).toEqual(freed);

  // Reset gives the whole photo back.
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);
}

async function turnedPicture(page: Page): Promise<void> {
  await openEditor(page);

  // Straightening tilts the picture; the box shrinks to stay ON it (no black
  // wedges in the export), keeping the photo's own shape…
  const slider = page.getByRole('slider', { name: 'Straighten angle' });
  await slider.fill('10');
  const tilted = await rectOf(page);
  expect(tilted.x).toBeGreaterThan(0);
  expect(tilted.y).toBeGreaterThan(0);
  expect(tilted.width).toBeLessThan(320);
  expect(Math.abs(tilted.width / tilted.height - 4 / 3)).toBeLessThan(0.03);
  // …and an untouched box comes all the way back with the slider.
  await slider.fill('0');
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  await expect(page.locator('[data-crop-readout]')).toHaveText('Drag the corners or edges to crop');

  // A handle dragged far past the tilted edge stops on the picture.
  await slider.fill('10');
  await drag(page, 'se', 0.6, 0.6);
  const pushed = await rectOf(page);
  expect(pushed.x + pushed.width).toBeLessThanOrEqual(tilted.x + tilted.width + 2);
  expect(pushed.y + pushed.height).toBeLessThanOrEqual(tilted.y + tilted.height + 2);
  // A box the person shaped is theirs: levelling the picture keeps it, and
  // Reset is how the whole photo comes back.
  await drag(page, 'nw', 0.3, 0.3);
  const shaped = await rectOf(page);
  await slider.fill('0');
  // (The frame shrinks round the picture's centre as it levels, so the box
  // keeps its size and its offset from that centre.)
  const levelled = await rectOf(page);
  expect(levelled.width).toBe(shaped.width);
  expect(levelled.height).toBe(shaped.height);
  const tiltedFrame = {
    width: 320 * Math.cos(Math.PI / 18) + 240 * Math.sin(Math.PI / 18),
    height: 320 * Math.sin(Math.PI / 18) + 240 * Math.cos(Math.PI / 18),
  };
  expect(Math.abs(levelled.x - 160 - (shaped.x - tiltedFrame.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(levelled.y - 120 - (shaped.y - tiltedFrame.height / 2))).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });

  // A quarter turn swaps the frame and carries a crop with the picture.
  await page.getByRole('button', { name: 'Rotate 90 degrees' }).click();
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 240, height: 320 });
  await drag(page, 'se', -0.5, -0.25);
  const upright = await rectOf(page);
  expect(Math.abs(upright.width - 120)).toBeLessThanOrEqual(4);
  expect(Math.abs(upright.height - 240)).toBeLessThanOrEqual(4);
  await page.getByRole('button', { name: 'Rotate 90 degrees' }).click();
  const turned = await rectOf(page);
  expect(turned.width).toBe(upright.height);
  expect(turned.height).toBe(upright.width);
  expect(turned.x).toBe(320 - upright.height);
  expect(turned.y).toBe(0);
}

async function videoCrop(page: Page): Promise<void> {
  await page.goto('/feed');
  const canRecord = await page.evaluate(() => 'MediaRecorder' in window);
  test.skip(!canRecord, 'MediaRecorder unavailable in this browser');

  // A real clip, recorded in-browser (the capture-attach spec's fixture).
  const clip = await page.evaluate(async () => {
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
        if (t < 2000) requestAnimationFrame(draw);
        else {
          rec.stop();
          resolve();
        }
      };
      draw();
    });
    const blob = await stopped;
    return { data: Array.from(new Uint8Array(await blob.arrayBuffer())), mime };
  });

  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: clip.mime === 'video/webm' ? 'clip.webm' : 'clip.mp4',
    mimeType: clip.mime,
    buffer: Buffer.from(clip.data),
  });
  // Oct 4 2026: a library video attaches as a tile first; the editor is the
  // tile's Edit button.
  await page.getByRole('button', { name: 'Edit media', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 20_000 });

  // Video has the same box: any area, by hand.
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(page.locator('[data-crop-box]')).toBeVisible({ timeout: 20_000 });
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  await drag(page, 'se', -0.3, -0.5);
  const cropped = await rectOf(page);
  expect(Math.abs(cropped.width - 224)).toBeLessThanOrEqual(4);
  expect(Math.abs(cropped.height - 120)).toBeLessThanOrEqual(4);

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect(await rectOf(page)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
}

test('hands-on crop: corners, edges, move, pinch, keyboard, ratio lock, export', async ({ page }) => {
  test.setTimeout(180_000);
  await customCrop(page);
});

test('hands-on crop: corners, edges, move, pinch, keyboard, ratio lock, export @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await customCrop(page);
});

test('hands-on crop: the box stays on a straightened picture and turns with it', async ({ page }) => {
  test.setTimeout(120_000);
  await turnedPicture(page);
});

test('hands-on crop: the box stays on a straightened picture and turns with it @mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await turnedPicture(page);
});

test('hands-on crop: video gets the same box', async ({ page }) => {
  test.setTimeout(180_000);
  await videoCrop(page);
});

test('hands-on crop: video gets the same box @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await videoCrop(page);
});
