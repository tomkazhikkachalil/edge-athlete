import { test, expect } from './helpers/test';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 6 — the athlete drill-down. From the game's box score, any
// athlete opens: their line for the game beside their clips, narrowed to
// the scoring plays, one period, or one kind of play; a clip plays the
// video there and "Play these" walks the ones on screen. Someone who is in
// clips without a stat ("also in the clip") can be opened too. A viewer who
// has not watched is offered nobody — the box score is empty until the
// video gets there.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('an athlete\'s clips in a game: the line, the filters (scoring · period · kind), play one, play these; "also in clips"; nothing for a viewer who has not watched — at 375 px', async ({ browser }) => {
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
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Drill-down ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const guard = { name: 'QA Guard', role: 'scorer' };
    const tags = [
      { start_ms: 1000, label: 'Layup', event_key: 'fg2_made', side: 1, period: 1, people: [guard] },
      { start_ms: 3000, label: 'Pick', event_key: 'steal', side: 1, period: 1, people: [{ name: 'QA Guard', role: 'player' }] },
      { start_ms: 6000, label: 'From deep', event_key: 'fg3_made', side: 1, period: 3, people: [guard, { name: 'QA Mascot', role: 'in_clip' }] },
      { start_ms: 9000, label: 'Dish', event_key: 'fg2_made', side: 1, period: 4, people: [{ name: 'QA Center', role: 'scorer' }, { name: 'QA Guard', role: 'assist' }] },
      { start_ms: 12_000, label: 'Answer', event_key: 'fg2_made', side: 2, period: 4, people: [{ name: 'QA Owl', role: 'scorer' }] },
    ];
    for (const tag of tags) {
      res = await api.post(`/api/videos/${videoId}/highlights`, { data: tag });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }

    // 1. The manager opens QA Guard from the box score: the line and all four clips.
    const page = await ownerCtx.newPage();
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-game-board="7-2"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-game-box="QA Hawks"] [data-game-player-open="n:qa guard"]').click();
    const clips = page.locator('[data-athlete-clips="n:qa guard"]');
    await expect(clips).toBeVisible();
    await expect(clips.locator('[data-athlete-clips-name]')).toHaveText('QA Guard');
    await expect(clips).toHaveAttribute('data-athlete-clips-shown', '4');
    await expect(clips.locator('[data-athlete-clips-line]')).toContainText('5'); // 2 + 3 points
    await expect(clips.locator('[data-athlete-clips-line]')).toContainText('AST');
    expect(await fitsViewportWidth(page)).toBe(true);

    // 2. Narrow: the scoring plays (the two baskets and the assist on a third), the third quarter, the steals.
    await clips.locator('[data-athlete-clips-filter="scoring"]').click();
    await expect(clips).toHaveAttribute('data-athlete-clips-shown', '3');
    await clips.locator('[data-athlete-clips-filter="period-3"]').click();
    await expect(clips).toHaveAttribute('data-athlete-clips-shown', '1');
    await expect(clips.locator('[data-athlete-clip]')).toContainText('From deep');
    await clips.locator('[data-athlete-clips-filter="event-steal"]').click();
    await expect(clips).toHaveAttribute('data-athlete-clips-shown', '1');
    await expect(clips.locator('[data-athlete-clip]')).toContainText('Pick');
    await clips.locator('[data-athlete-clips-filter="all"]').click();
    await expect(clips).toHaveAttribute('data-athlete-clips-shown', '4');
    await expect(clips.locator('[data-athlete-clips-play-all]')).toContainText('Play these 4');
    expect(await fitsViewportWidth(page)).toBe(true);

    // 3. A clip plays the video there: the highlight row is the active one.
    const firstClip = clips.locator('[data-athlete-clip]').first();
    const firstId = await firstClip.getAttribute('data-athlete-clip');
    await firstClip.click();
    await expect(page.locator(`[data-highlight-play="${firstId}"]`)).toHaveAttribute('aria-pressed', 'true');

    // 4. Another athlete replaces the first; "also in clips" opens someone with no stat line; Close closes.
    await page.locator('[data-game-box="QA Owls"] [data-game-player-open="n:qa owl"]').click();
    await expect(page.locator('[data-athlete-clips="n:qa owl"]')).toHaveAttribute('data-athlete-clips-shown', '1');
    await expect(page.locator('[data-athlete-clips="n:qa guard"]')).toHaveCount(0);
    await page.locator('[data-game-also-in] [data-game-player-open="n:qa mascot"]').click();
    const mascot = page.locator('[data-athlete-clips="n:qa mascot"]');
    await expect(mascot).toHaveAttribute('data-athlete-clips-shown', '1');
    await expect(mascot.locator('[data-athlete-clips-line]')).toHaveCount(0);
    await mascot.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-athlete-clips]')).toHaveCount(0);

    // 5. The recap carries the same drill-down, and a clip from it leads back to the video.
    await page.goto(`/videos/${videoId}?view=recap`);
    await expect(page.locator('[data-game-recap="all"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-game-box="QA Hawks"] [data-game-player-open="n:qa guard"]').click();
    await page.locator('[data-athlete-clips="n:qa guard"] [data-athlete-clip]').first().click();
    await expect(page.locator('[data-video-player]')).toBeVisible();
    await expect(page.locator('[data-game-recap]')).toHaveCount(0);

    // 6. A viewer who has not watched: nobody to open — no box score, no "also in clips".
    const v = await viewerCtx.newPage();
    await v.goto(`/videos/${videoId}`);
    await expect(v.locator('[data-game-stats="progressive"]')).toBeVisible({ timeout: 20_000 });
    await expect(v.locator('[data-game-player-open]')).toHaveCount(0);
    await expect(v.locator('[data-game-also-in]')).toHaveCount(0);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('youtube_connections').delete().eq('profile_id', owner.id);
    await admin.from('profiles').update({ visibility: (prior as { visibility: string } | null)?.visibility ?? 'private' }).eq('id', owner.id);
    await api.dispose();
    await ownerCtx.close();
    await viewerCtx.close();
  }
});
