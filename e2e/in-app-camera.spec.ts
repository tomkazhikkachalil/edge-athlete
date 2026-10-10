import { test, expect } from '@playwright/test';

// The in-app camera (Sep 3 2026, round 10): the composer's fallback for a
// native photo picker that fails inside iOS's own screen. The `mobile` project
// launches Chromium with a fake camera device (playwright.config.ts), so the
// stream → shutter → File → editor path is testable; WebKit has no fake device.
test('the in-app camera attaches a photo and a recorded clip as tiles @mobile', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no fake camera device; the path is proved on Chromium');
  test.setTimeout(120_000);

  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await expect(page.getByPlaceholder('Share your thoughts...')).toBeVisible();

  // Touch-only affordance: the mobile project's device has maxTouchPoints > 1
  // only when emulated — set it so the link renders, as it would on a phone.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  });
  await page.reload();
  await page.getByRole('button', { name: /create a post/i }).click();
  await page.getByRole('button', { name: 'Camera not working? Use the in-app camera' }).click();

  const dialog = page.getByRole('dialog', { name: 'In-app camera' });
  await expect(dialog).toBeVisible();
  const video = page.getByTestId('in-app-camera-video');
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);

  await dialog.getByRole('button', { name: 'Capture photo' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  // Capture v2: the photo attaches as a tile at once; no editor in between.
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Edit media' })).toHaveCount(0);

  // Video mode: record ~2s with the fake device, stop → a second tile.
  await page.getByRole('button', { name: 'Camera not working? Use the in-app camera' }).click();
  const dialog2 = page.getByRole('dialog', { name: 'In-app camera' });
  await dialog2.getByRole('button', { name: 'Video' }).click();
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  const start = dialog2.getByRole('button', { name: 'Start recording' });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(dialog2.getByText(/● \d+s/)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2000);
  await dialog2.getByRole('button', { name: 'Stop recording' }).click();
  await expect(dialog2).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(2, { timeout: 10_000 });
});

// Maintenance pass (Oct 10 2026): the camera never stays on behind the app.
// Going to the background ends every track (the device's indicator turns
// off) and coming back starts the preview again; Cancel mid-recording
// delivers nothing.
test('the in-app camera lets go of the camera when hidden, and a cancel delivers nothing @mobile', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no fake camera device; the path is proved on Chromium');
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    const w = window as unknown as { __streams: MediaStream[] };
    w.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => {
      const s = await original(c);
      w.__streams.push(s);
      return s;
    };
  });
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate(s => {
      Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => s === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  const liveTracks = () =>
    page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length);

  await page.goto('/feed');
  await page.getByRole('button', { name: /create a post/i }).click();
  await page.getByRole('button', { name: 'Camera not working? Use the in-app camera' }).click();
  const dialog = page.getByRole('dialog', { name: 'In-app camera' });
  const video = page.getByTestId('in-app-camera-video');
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  expect(await liveTracks()).toBeGreaterThan(0);

  await setVisibility('hidden');
  await expect.poll(liveTracks, { timeout: 5_000 }).toBe(0);
  await setVisibility('visible');
  await expect.poll(liveTracks, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);

  // Record, then Cancel: no tile, and the camera is off.
  await dialog.getByRole('button', { name: 'Video' }).click();
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  const start = dialog.getByRole('button', { name: 'Start recording' });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(dialog.getByText(/● \d+s/)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1500);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: 'Edit media', exact: true })).toHaveCount(0);
  await expect.poll(liveTracks, { timeout: 5_000 }).toBe(0);
});
