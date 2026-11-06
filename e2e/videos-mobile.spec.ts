import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { cleanup } from './helpers/cleanup';
import path from 'node:path';

// Videos program (296) at phone width: the Videos tab is reachable on the
// profile (/athlete?tab=videos), the video page fits the viewport with the
// 16:9 player, the highlight row is a 44 px target, and the new-video steps
// render one column. Web and mobile ship together.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

test('videos at phone width: the tab, the page, the player, the steps @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const me = loadQaUser('user.json');
  await resetRateBucket(admin, 'video-write', me.id);
  const api = await apiAs('state.json');
  const title = `QA Phone game ${Date.now()}`;
  let videoId: string | null = null;
  try {
    let res = await api.post('/api/videos', { data: { url: YT, title } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 12_000, label: 'QA phone moment', meta: { hole: 3 } } });
    expect(res.status(), await readErrorBody(res)).toBe(201);

    // The tab, deep-linked, fits the viewport; the card is there.
    await page.goto('/athlete?tab=videos');
    const card = page.locator(`[data-video-card="${videoId}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    expect(await fitsViewportWidth(page)).toBe(true);

    // The video page: the player's box is 16:9 and no wider than the viewport.
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/videos/${videoId}`), { timeout: 20_000 });
    const player = page.locator('[data-video-player="jNQXAC9IVRw"]');
    await expect(player).toBeVisible({ timeout: 20_000 });
    expect(await fitsViewportWidth(page)).toBe(true);
    const box = await player.locator('[data-video-poster]').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.05);
    // Optional visual dump (E2E_DUMP_DIR precedent): the page in light, then in dark (the ea-theme cookie).
    const dump = process.env.E2E_DUMP_DIR;
    if (dump) {
      await page.screenshot({ path: path.join(dump, 'video-page-light.png'), fullPage: true });
      // The middleware refreshes the theme cookie from profiles.theme_prefs on every navigation: dark = mode 'on'.
      await admin.from('profiles').update({ theme_prefs: { mode: 'on' } }).eq('id', me.id);
      await page.reload();
      await expect(player).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark'), { timeout: 10_000 }).toBe(true);
      await page.screenshot({ path: path.join(dump, 'video-page-dark.png'), fullPage: true });
      await admin.from('profiles').update({ theme_prefs: { mode: 'off' } }).eq('id', me.id);
      await page.reload();
      await expect(player).toBeVisible({ timeout: 20_000 });
    }

    // The highlight row is a real target; tapping it seeks.
    const play = page.locator('[data-highlight-play]').first();
    const rowBox = await play.boundingBox();
    expect(rowBox!.height).toBeGreaterThanOrEqual(44);
    await expect(play).toContainText('Hole 3');
    await play.click();
    await expect(player.locator('iframe')).toHaveAttribute('src', /start=12/, { timeout: 10_000 });
    expect(await fitsViewportWidth(page)).toBe(true);

    // The steps: one column, the link step refuses Next until a link is pasted, then advances.
    await page.goto('/videos/new');
    const flow = page.locator('[data-step-flow="new-video"]');
    await expect(flow).toBeVisible({ timeout: 20_000 });
    await expect(flow.locator('[data-step-header]')).toHaveText(/Step 1 of 3 · Link/);
    await expect(page.locator('[data-new-video-url]')).not.toBeFocused();
    await page.locator('[data-new-video-url]').fill('not a link');
    await expect(flow.getByText('That is not a YouTube video link we can play.')).toBeVisible();
    await page.locator('[data-new-video-url]').fill(YT);
    await expect(page.locator('[data-new-video-preview="jNQXAC9IVRw"]')).toBeVisible();
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    await cleanup('videos-mobile', [
      async () => {
        if (videoId) await api.delete(`/api/videos/${videoId}`);
      },
      () => api.dispose(),
    ]);
  }
});
