import { test, expect } from './helpers/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { cleanup } from './helpers/cleanup';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 3 PR 2 (migration 307): a linked video becomes a GAME — its sport,
// the two sides, the day, whether every scoring play is tagged, and the
// spoiler-free default. A manager makes and edits it on the video page; a
// stranger of a private profile sees nothing; the API takes the whole game
// and refuses what is not one. Removing it leaves the video and its highlights.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('a video becomes a game: the manager adds the details on the page, edits them, the API checks them, a stranger cannot, removing keeps the video @mobile', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const me = loadQaUser('user.json');
  await resetRateBucket(admin, 'video-write', me.id);
  const api = await apiAs('state.json');
  const other = await apiAs('state-b.json');
  let videoId: string | null = null;
  let unseed: (() => Promise<void>) | null = null;
  try {
    unseed = await seedOwnChannel(admin, { profileId: me.id }, me.id);
    await admin.from('videos').delete().eq('profile_id', me.id).eq('provider_video_id', 'jNQXAC9IVRw');
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Game film ${Date.now()}`, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;

    // 1. No game yet: the read says so; the API refuses what is not a game.
    res = await api.get(`/api/videos/${videoId}/game`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(await res.json()).toMatchObject({ game: null, can_manage: true });
    expect((await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'curling' } })).status()).toBe(400);
    expect((await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: '2026-02-30' } })).status()).toBe(400);
    expect((await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', score: 3 } })).status()).toBe(400);
    // A stranger (the QA profile is private) cannot read or write it: the video's own 404.
    expect((await other.get(`/api/videos/${videoId}/game`)).status()).toBe(404);
    expect((await other.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball' } })).status()).toBe(404);

    // 2. On the page: the manager's door, the form (the video's sport is already chosen), Save → the title line.
    await page.goto(`/videos/${videoId}`);
    await expect(page.locator('[data-video-game="none"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-video-game-start]').click();
    await expect(page.locator('[data-video-game-sport]')).toHaveValue('basketball');
    await page.locator('[data-video-game-side="1"]').fill('QA Hawks');
    await page.locator('[data-video-game-side="2"]').fill('QA Owls');
    await page.locator('[data-video-game-date]').fill('2026-11-01');
    expect(await fitsViewportWidth(page)).toBe(true);
    await page.locator('[data-video-game-save]').click();
    await expect(page.locator('[data-video-game-title]')).toHaveText('QA Hawks vs QA Owls', { timeout: 20_000 });
    await expect(page.locator('[data-video-game="basketball"]')).toBeVisible();
    await expect(page.locator('[data-video-game-coverage="highlights"]')).toContainText('stats hidden');
    res = await api.get(`/api/videos/${videoId}`);
    expect((await res.json()).game).toMatchObject({ sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks', team_id: null }, side2: { name: 'QA Owls', team_id: null }, coverage: 'highlights', stats_hidden: true });

    // 3. Edit: every scoring play is tagged, spoilers allowed — and it is still there after a reload.
    await page.locator('[data-video-game-edit]').click();
    await page.locator('[data-video-game-coverage-option="full"]').check();
    await page.locator('[data-video-game-hidden]').uncheck();
    await page.locator('[data-video-game-save]').click();
    await expect(page.locator('[data-video-game-coverage="full"]')).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.locator('[data-video-game-title]')).toHaveText('QA Hawks vs QA Owls', { timeout: 20_000 });
    expect(((await (await api.get(`/api/videos/${videoId}/game`)).json()).game)).toMatchObject({ coverage: 'full', stats_hidden: false });

    // 4. A sport without sides (a race) drops them; a combat sport names fighters.
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'running', side1: null, side2: null } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await page.reload();
    await expect(page.locator('[data-video-game-title]')).toHaveText('Race', { timeout: 20_000 });

    // 5. Remove: the confirm names what is lost; the video stays.
    await page.locator('[data-video-game-edit]').click();
    await page.locator('[data-video-game-remove]').click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('[data-video-game="none"]')).toBeVisible({ timeout: 20_000 });
    expect((await (await api.get(`/api/videos/${videoId}`)).json())).toMatchObject({ game: null, video: { id: videoId } });
  } finally {
    await cleanup('video-game', [
      async () => { if (videoId) await api.delete(`/api/videos/${videoId}`); },
      async () => { await unseed?.(); },
      () => api.dispose(),
      () => other.dispose(),
    ]);
  }
});
