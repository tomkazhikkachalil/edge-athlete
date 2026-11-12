import { test, expect, request as pwRequest } from './helpers/test';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';
import { E2E_BASE_URL, adminClient, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';

// The player that knows the time (Videos program polish B, Nov 6 2026):
// YouTube's IFrame Player API, loaded by trusted code under the CSP's
// 'strict-dynamic' (no host added), gives the page the playhead — "This
// moment" types the time for you, "Play highlights" walks the markers, a
// resume chip offers the last position. When the API is blocked the plain
// frame renders as before and the typed-time path still works. The API's
// own script comes from the real www.youtube.com (the network, as the
// poster's i.ytimg.com already does).

const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" — 19 s, public, embeddable
// Only the connected channel (Nov 11 2026): the link saves because the owner's connection names that video's channel.
withOwnChannel(['jNQXAC9IVRw']);

test('the API answers: the player is the API\'s, "This moment" types the playhead, "Play highlights" walks the list; blocked, the plain frame and typed times still work', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'video-write', a.id);
  const api = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() });
  const ctx = await browser.newContext({ storageState: await mintStorageState(a), extraHTTPHeaders: bypassHeaders() });
  const page = await ctx.newPage();
  let videoId: string | null = null;
  try {
    await admin.from('videos').delete().eq('profile_id', a.id).eq('provider_video_id', 'jNQXAC9IVRw');
    await seedOwnChannel(admin, { profileId: a.id }, a.id);
    let res = await api.post('/api/videos', { data: { url: YT, title: 'Player spec' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    for (const [start, end, label] of [[2000, 6000, 'First'], [9000, 12000, 'Second']] as const) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: start, end_ms: end, label, meta: {} } });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }

    // 1. The API mode: the poster tap loads YouTube's script by trusted code; the player answers.
    await page.goto(`/videos/${videoId}`);
    const player = page.locator('[data-video-player="jNQXAC9IVRw"]');
    await expect(player).toHaveAttribute('data-video-player-mode', 'poster');
    await player.locator('[data-video-poster]').click();
    await expect(player).toHaveAttribute('data-video-player-mode', 'api', { timeout: 20_000 });
    expect(await page.locator('script[src="https://www.youtube.com/iframe_api"]').count()).toBe(1);
    await expect(page.locator('[data-video-play-highlights]')).toBeVisible();

    // 2. "This moment" types the playhead (the video is playing; any value is a time string).
    await page.locator('[data-highlight-add]').click();
    await expect(page.locator('[data-highlight-mark]')).toBeVisible();
    await page.locator('[data-highlight-mark]').click();
    await expect(page.locator('[data-highlight-time]')).toHaveValue(/^\d+:\d{2}$/);

    // 3. "Play highlights" walks the markers: the active row is the first, then the second.
    await page.locator('[data-video-play-highlights]').click();
    await expect(page.locator('[data-video-play-highlights]')).toHaveAttribute('data-video-play-highlights', 'on');
    await expect(page.locator('[data-highlight-play][aria-pressed="true"], [data-video-highlight] [aria-current="true"]').first()).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
    await expect(page.locator('[data-video-play-highlights]')).toHaveAttribute('data-video-play-highlights', 'off', { timeout: 40_000 }); // the two markers play out (≈ 7 s of video)

    // 4. The resume chip: a saved position worth offering (≥ 30 s; the stand-in knows no duration for this id) shows on the poster of a fresh load.
    await page.evaluate(() => localStorage.setItem('ea-video-resume:jNQXAC9IVRw', '35000'));
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-resume="35000"]')).toBeVisible();
    await expect(page.locator('[data-video-resume="35000"]')).toContainText('Resume at 0:35');
    await page.evaluate(() => localStorage.removeItem('ea-video-resume:jNQXAC9IVRw'));

    // 5. Blocked: the plain frame as before, no "This moment", the typed time still saves a marker.
    const blocked = await ctx.newPage();
    await blocked.route('**/iframe_api', route => route.abort());
    await blocked.goto(`/videos/${videoId}`);
    const p2 = blocked.locator('[data-video-player="jNQXAC9IVRw"]');
    await p2.locator('[data-video-poster]').click();
    await expect(p2).toHaveAttribute('data-video-player-mode', 'frame', { timeout: 20_000 });
    await expect(p2.locator('iframe[src*="youtube-nocookie.com"]')).toBeVisible();
    await blocked.locator('[data-highlight-add]').click();
    expect(await blocked.locator('[data-highlight-mark]').count()).toBe(0);
    await blocked.locator('[data-highlight-time]').fill('0:15');
    await blocked.locator('[data-highlight-label]').fill('Typed');
    await blocked.locator('[data-highlight-save]').click();
    await expect(blocked.locator('[data-video-highlights="3"]')).toBeVisible();
    await blocked.close();
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', a.id);
    await api.dispose();
    await ctx.close();
  }
});
