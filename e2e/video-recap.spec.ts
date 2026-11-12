import { test, expect } from './helpers/test';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 5 — the game recap: the page a club shares after the game
// (`/videos/<id>?view=recap`). Who played and when, the final score with the
// score by period, the box scores, the team stats, the scoring summary in
// order and the top highlights — all derived from the tags. The manager sees
// it at once; a viewer who has not watched is asked first (the recap IS the
// spoiler). "Watch the game" and a highlight lead back to the video.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('the recap: the link opens it, the manager reads the whole game, a viewer is asked first, the doors lead back to the video — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user.json');
  const viewer = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const api = await apiAs('state.json');
  const ownerCtx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const viewerCtx = await browser.newContext({ storageState: await mintStorageState(viewer), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  const { data: prior } = await admin.from('profiles').select('visibility').eq('id', owner.id).single();
  try {
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', owner.id);
    await seedOwnChannel(admin, { profileId: owner.id }, owner.id);
    await admin.from('videos').delete().eq('profile_id', owner.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Recap game ${Date.now()}`, sport_key: 'soccer' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'soccer', played_on: '2026-11-01', side1: { name: 'QA Rovers' }, side2: { name: 'QA United' }, coverage: 'full' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const tags = [
      { start_ms: 1000, end_ms: 3000, label: 'Opener', event_key: 'goal', side: 1, period: 1, people: [{ profile_id: owner.id, role: 'scorer' }, { name: 'QA Winger', role: 'assist' }] },
      { start_ms: 5000, label: 'Corner', event_key: 'corner', side: 2, period: 1 },
      { start_ms: 7000, label: 'Booked', event_key: 'yellow_card', side: 2, period: 1, people: [{ name: 'QA Stopper', role: 'player' }] },
      { start_ms: 9000, end_ms: 11_000, label: 'Own goal', event_key: 'own_goal', side: 1, period: 2, people: [{ name: 'QA Winger', role: 'player' }] },
      { start_ms: 13_000, end_ms: 15_000, label: 'Winner', event_key: 'goal', side: 1, period: 2, people: [{ name: 'QA Winger', role: 'scorer' }] },
      { start_ms: 16_000, label: 'What a save' },
    ];
    for (const tag of tags) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }

    // 1. The manager opens the shared link: the whole game, nothing asked.
    const mgr = await ownerCtx.newPage();
    await mgr.goto(`/videos/${videoId}?view=recap`);
    await expect(mgr.locator('[data-game-recap="all"]')).toBeVisible({ timeout: 20_000 });
    await expect(mgr.locator('[data-game-recap-title]')).toHaveText('QA Rovers vs QA United');
    await expect(mgr.locator('[data-game-board="2-1"]')).toBeVisible();
    await expect(mgr.locator('[data-game-periods="2"]')).toBeVisible();
    await expect(mgr.locator('[data-game-box="QA Rovers"]')).toContainText('QA Winger');
    await expect(mgr.locator('[data-game-box="QA United"]')).toContainText('QA Stopper');
    await expect(mgr.locator('[data-game-team-stats]')).toContainText('Corners');
    //    The scoring summary in order, the own goal credited to the other side, the running score on each row.
    const rows = mgr.locator('[data-game-summary="3"] [data-game-summary-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('1–0');
    await expect(rows.nth(1)).toContainText('QA United');
    await expect(rows.nth(1)).toContainText('1–1');
    await expect(rows.nth(2)).toContainText('2–1');
    //    Top highlights: six at most — here all six tags fit (the order of preference is unit-pinned in game-view.test.ts).
    await expect(mgr.locator('[data-game-recap-top] [data-game-recap-highlight]')).toHaveCount(6);
    await expect(mgr.locator('[data-video-player]')).toBeHidden();
    expect(await fitsViewportWidth(mgr)).toBe(true);

    // 2. A top highlight leads back to the video, playing it; the address is the video's again; "Game recap" returns.
    await mgr.locator('[data-game-recap-highlight]').first().click();
    await expect(mgr.locator('[data-video-player]')).toBeVisible();
    await expect(mgr.locator('[data-game-recap]')).toHaveCount(0);
    await expect.poll(() => new URL(mgr.url()).search).toBe('');
    await mgr.locator('[data-video-open-recap]').click();
    await expect(mgr.locator('[data-game-recap="all"]')).toBeVisible();
    await expect.poll(() => new URL(mgr.url()).search).toBe('?view=recap');
    await mgr.locator('[data-game-recap-watch]').click();
    await expect(mgr.locator('[data-video-player]')).toBeVisible();

    // 3. A viewer who has not watched: the recap asks first — no score, no rows, no top highlights; the confirm shows it.
    const page = await viewerCtx.newPage();
    await page.goto(`/videos/${videoId}?view=recap`);
    await expect(page.locator('[data-game-recap="progressive"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-game-recap-gate]')).toContainText('Watch the game first');
    await expect(page.locator('[data-game-board="0-0"]')).toBeVisible();
    await expect(page.locator('[data-game-recap-top]')).toHaveCount(0);
    expect(await page.locator('[data-game-recap]').innerText()).not.toContain('QA Winger');
    expect(await fitsViewportWidth(page)).toBe(true);
    await page.locator('[data-game-unlock]').click();
    await page.getByRole('button', { name: 'Show everything', exact: true }).click();
    await expect(page.locator('[data-game-recap="all"]')).toBeVisible();
    await expect(page.locator('[data-game-board="2-1"]')).toBeVisible();
    await expect(page.locator('[data-game-recap-top]')).toBeVisible();
    expect(await fitsViewportWidth(page)).toBe(true);

    // 4. A video that is not a game has no recap: the link is simply the video.
    res = await api.delete(`/api/videos/${videoId}/game`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await mgr.goto(`/videos/${videoId}?view=recap`);
    await expect(mgr.locator('[data-video-player]')).toBeVisible({ timeout: 20_000 });
    await expect(mgr.locator('[data-game-recap]')).toHaveCount(0);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', owner.id);
    await admin.from('profiles').update({ visibility: (prior as { visibility: string } | null)?.visibility ?? 'private' }).eq('id', owner.id);
    await api.dispose();
    await ownerCtx.close();
    await viewerCtx.close();
  }
});
