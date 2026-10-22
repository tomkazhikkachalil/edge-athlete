import { test, expect, type Page } from './helpers/test';
import sharp from 'sharp';
import { createQaUser, deleteQaUser, mintStorageState, type QaUser } from './helpers/qa-user';

// Photo → editor, timed (Oct 15 2026). Tom: "improve the speed from when a
// photo is taken to when it's uploaded for edit, same rule for when the user
// selects a photo, there seems to be a delay." This spec measures the wait a
// person sees — the file chosen → the editor's stage showing the picture —
// with a phone-sized photo (4032 × 3024 JPEG), in a fresh context (a cold
// cache, the first open of the session). It records the numbers as
// annotations (the devlog keeps the before/after) and fails only on a
// regression far past anything a phone should show.

const LIBRARY = 'input[type="file"][multiple][accept="image/*,video/*"]';
let photo: Buffer;
let user: QaUser | null = null;
let state: Awaited<ReturnType<typeof mintStorageState>> | null = null;

test.beforeAll(async () => {
  const W = 4032;
  const H = 3024;
  const raw = Buffer.alloc(W * H * 3);
  let seed = 1;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 24; };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      raw[i] = ((x * 255) / W + noise()) & 255;
      raw[i + 1] = ((y * 255) / H + noise()) & 255;
      raw[i + 2] = (((x + y) * 128) / W + noise()) & 255;
    }
  }
  photo = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  user = await createQaUser({ displayName: 'Edge QA Timing', firstName: 'Edge', lastName: 'Timing' });
  state = await mintStorageState(user);
});

test.afterAll(async () => {
  if (user) await deleteQaUser(user.id);
});

/** The editor's stage is showing the picture: a decoded image inside the editor dialog. */
async function stageReady(page: Page) {
  await page.waitForFunction(() => {
    const editor = document.querySelector('[role="dialog"][aria-label="Edit media"]');
    if (!editor) return false;
    return [...editor.querySelectorAll('img')].some(img => img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0);
  }, undefined, { timeout: 30_000, polling: 'raf' });
}

/** The OS picker is open for a moment before a photo comes back (a person
 *  choosing): the clock starts when the file arrives, as the person sees it. */
const PICKER_MS = 1500;

async function timedPick(page: Page, input: string, opts: { expectOpening: boolean }): Promise<number> {
  await page.waitForTimeout(PICKER_MS);
  const started = Date.now();
  await page.locator(input).first().setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });
  // While the picture decodes the stage says so (Oct 22 2026): the spinner and
  // "Opening photo…" over the stage, gone with the first visible frame. Seen
  // for sure only where the decode is slowed (the throttled Chromium run); an
  // unthrottled WebKit may be ready before the poll looks.
  const opening = page.locator('[data-editor-opening]');
  if (opts.expectOpening) await expect(opening).toBeVisible({ timeout: 10_000 });
  await stageReady(page);
  await expect(opening).toBeHidden({ timeout: 10_000 });
  return Date.now() - started;
}

test('@mobile a library photo reaches the editor quickly — composer and profile picture', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ storageState: state! });
  try {
    const page = await ctx.newPage();
    // Chromium: a mid-range phone's CPU (4× slower than this machine) — the
    // decode and the chunk evaluation are CPU-bound. WebKit has no throttle
    // (its numbers are this machine's, a floor); nor has Firefox (no CDP).
    if (testInfo.project.use.browserName !== 'webkit' && testInfo.project.use.browserName !== 'firefox') {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      // …on a phone connection (150 ms RTT, ~1.6 Mbps down): a code chunk
      // fetched at the moment of the pick is paid for here, as on a phone.
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
    }
    await page.goto('/feed');
    await page.getByRole('button', { name: /create a post/i }).click();
    await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible({ timeout: 30_000 });
    const throttled = testInfo.project.use.browserName !== 'webkit' && testInfo.project.use.browserName !== 'firefox';
    const composer = await timedPick(page, LIBRARY, { expectOpening: throttled });

    await page.goto('/athlete');
    await page.getByRole('button', { name: 'Add profile picture', exact: true }).click({ timeout: 30_000 });
    const avatar = await timedPick(page, '[data-photo-door="avatar"] input[aria-label="Choose a profile photo"]', { expectOpening: throttled });

    for (const [name, ms] of [['composer pick → editor', composer], ['profile picture pick → editor', avatar]] as const) {
      testInfo.annotations.push({ type: 'timing', description: `${testInfo.project.name} · ${name}: ${ms} ms` });
      console.log(`[timing] ${testInfo.project.name} · ${name}: ${ms} ms`);
      expect(ms, name).toBeLessThan(15_000);
    }
  } finally {
    await ctx.close();
  }
});
