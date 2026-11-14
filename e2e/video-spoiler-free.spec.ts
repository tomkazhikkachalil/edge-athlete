import { test, expect, request as pwRequest } from './helpers/test';
import { E2E_BASE_URL, adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 4 — the spoiler-free view. A game's stats are built from its
// tags; a VIEWER sees only what the video has played past: nothing at first,
// each stat as the playhead passes its clip's end, and everything after
// "Show full stats" (a confirm — it spoils the game), which stays unlocked
// on the device. The manager sees everything at once. The video is
// YouTube's first upload (19 s) played by the real IFrame API, as in
// videos-player.spec.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('a viewer watches the stats unlock: nothing at first, the first basket once its clip has played, everything after the confirm — and it stays unlocked; the manager sees it all', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user.json');
  const viewer = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const api = await apiAs('state.json');
  const viewerApi = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(viewer), extraHTTPHeaders: bypassHeaders() });
  const viewerCtx = await browser.newContext({ storageState: await mintStorageState(viewer), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const ownerCtx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders() });
  let videoId: string | null = null;
  // QA users are minted PRIVATE; a stranger watches the game only on a public profile. Restored in finally.
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', owner.id).single();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id);
    await seedOwnChannel(admin, { profileId: owner.id }, owner.id);
    await admin.from('videos').delete().eq('profile_id', owner.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Spoiler-free ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // A three for the Hawks early (its clip ends at 3 s); a two for the Owls late (the clip ends at 17 s).
    for (const tag of [
      { start_ms: 1000, end_ms: 3000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: owner.id, role: 'scorer' }] },
      { start_ms: 15_000, end_ms: 17_000, label: 'Two', event_key: 'fg2_made', side: 2, period: 1, people: [{ name: 'QA Owl Guard', role: 'scorer' }] },
    ]) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }

    // 1. The manager: everything at once — the board, both box scores, the summary, the timeline.
    const mgr = await ownerCtx.newPage();
    await mgr.goto(`/videos/${videoId}`);
    await expect(mgr.locator('[data-game-stats="all"]')).toBeVisible({ timeout: 20_000 });
    await expect(mgr.locator('[data-game-board="3-2"]')).toBeVisible();
    await expect(mgr.locator('[data-game-box="QA Hawks"]')).toContainText('3');
    await expect(mgr.locator('[data-game-box="QA Owls"]')).toContainText('QA Owl Guard');
    await expect(mgr.locator('[data-game-summary="2"]')).toBeVisible();
    await expect(mgr.locator('[data-tag-timeline="2"]')).toBeVisible();
    await expect(mgr.locator('[data-game-unlock]')).toHaveCount(0);

    // 2. A viewer, before playing: no score, no rows, no timeline — only that plays are ahead.
    const page = await viewerCtx.newPage();
    await page.goto(`/videos/${videoId}`);
    const stats = page.locator('[data-game-stats]');
    await expect(stats).toHaveAttribute('data-game-stats', 'progressive', { timeout: 20_000 });
    await expect(stats).toHaveAttribute('data-game-stats-shown', '0');
    await expect(page.locator('[data-game-board="0-0"]')).toBeVisible();
    await expect(page.locator('[data-game-spoiler-note]')).toContainText('2 tagged plays are still ahead');
    await expect(page.locator('[data-video-highlights="0"]')).toBeVisible();
    await expect(page.locator('[data-tag-timeline]')).toHaveCount(0);
    await expect(page.locator('[data-game-summary]')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('QA Owl Guard');
    expect(await fitsViewportWidth(page)).toBe(true);
    //    Round 2 PR 6: the unwatched plays never leave the server. A viewer's read carries none of them — only how many
    //    are ahead and when the next is due — until they say how far they have watched, or choose to see everything.
    res = await viewerApi.get(`/api/videos/${videoId}`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    let payload = await res.text();
    expect(payload).not.toContain('QA Owl Guard');
    expect(JSON.parse(payload)).toMatchObject({ can_manage: false, highlights: [], reveal: { mode: 'progressive', hidden: 2, ahead: 2, next_reveal_ms: 3000 } });
    res = await viewerApi.get(`/api/videos/${videoId}?upto=3000`);
    payload = await res.text();
    expect(payload).not.toContain('QA Owl Guard');
    expect(JSON.parse(payload)).toMatchObject({ highlights: [{ label: 'Three' }], reveal: { hidden: 1, ahead: 1, next_reveal_ms: 17000 } });
    res = await viewerApi.get(`/api/videos/${videoId}?reveal=all`);
    expect(JSON.parse(await res.text())).toMatchObject({ highlights: [{ label: 'Three' }, { label: 'Two' }], reveal: { mode: 'all', hidden: 0 } });
    //    The manager reads it all, whatever is asked.
    res = await api.get(`/api/videos/${videoId}?upto=0`);
    expect(((await res.json()).highlights as unknown[]).length).toBe(2);

    // 3. Play: once the first clip has played, the three is on the board and in the list; the two is still ahead.
    const player = page.locator('[data-video-player="jNQXAC9IVRw"]');
    await player.locator('[data-video-poster]').click();
    await expect(player).toHaveAttribute('data-video-player-mode', 'api', { timeout: 20_000 });
    await expect(stats).toHaveAttribute('data-game-stats-shown', '1', { timeout: 30_000 });
    await expect(page.locator('[data-game-score="1"]')).toHaveText('3');
    await expect(page.locator('[data-game-score="2"]')).toHaveText('0');
    await expect(page.locator('[data-video-highlights="1"]')).toBeVisible();
    await expect(page.locator('[data-game-spoiler-note]')).toContainText('1 tagged play is still ahead');

    // 4. "Show full stats" asks first; Cancel changes nothing; confirming shows everything, the timeline included.
    await page.locator('[data-game-unlock]').click();
    await expect(page.getByText('It spoils the game')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(stats).toHaveAttribute('data-game-stats', 'progressive');
    await page.locator('[data-game-unlock]').click();
    await page.getByRole('button', { name: 'Show everything', exact: true }).click();
    await expect(stats).toHaveAttribute('data-game-stats', 'all');
    await expect(page.locator('[data-game-board="3-2"]')).toBeVisible();
    await expect(page.locator('[data-game-box="QA Owls"]')).toContainText('QA Owl Guard');
    await expect(page.locator('[data-video-highlights="2"]')).toBeVisible();
    await expect(page.locator('[data-tag-timeline="2"]')).toBeVisible();
    expect(await fitsViewportWidth(page)).toBe(true);

    // 5. It stays unlocked on this device.
    await page.reload();
    await expect(page.locator('[data-game-stats="all"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-game-board="3-2"]')).toBeVisible();

    // 6. Spoilers off by the owner: a fresh viewer sees everything without asking.
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const fresh = await (await browser.newContext({ storageState: await mintStorageState(viewer), extraHTTPHeaders: bypassHeaders() })).newPage();
    await fresh.goto(`/videos/${videoId}`);
    await expect(fresh.locator('[data-game-stats="all"]')).toBeVisible({ timeout: 20_000 });
    await expect(fresh.locator('[data-game-unlock]')).toHaveCount(0);
    await fresh.context().close();
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', owner.id);
    await admin.from('profiles').update({ visibility: (prior as { visibility: string } | null)?.visibility ?? 'private' }).eq('id', owner.id);
    await api.dispose();
    await viewerApi.dispose();
    await viewerCtx.close();
    await ownerCtx.close();
  }
});
