import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 4 PRs 3–6a (Nov 2026) — the athlete's sport profile, the page: pick the
// sport, Career → Season → Game → Play, every number a door to its clips, Back
// walks up, every level is an address, the same page by id and by handle, at
// phone width.
const YT = 'jNQXAC9IVRw';
withOwnChannel([YT]);

test('the sport profile: career → season → game → play, the doors and the reel, back, by id and by handle — at 375 px @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  const follower = loadQaUser('user-c.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Sport Page League ${stamp}`, owner_profile_id: owner.id, sport_key: 'soccer', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const phone = { viewport: { width: 375, height: 800 }, extraHTTPHeaders: bypassHeaders() };
  const athleteCtx = await browser.newContext({ storageState: await mintStorageState(athlete), ...phone });
  const followerCtx = await browser.newContext({ storageState: await mintStorageState(follower), ...phone });
  const since = new Date().toISOString();
  let videoId: string | null = null;
  try {
    const member = await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' });
    expect(member.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: league.id }, owner.id);
    const follow = await admin.from('follows').insert({ follower_id: follower.id, following_id: athlete.id, status: 'accepted' });
    expect(follow.error?.message ?? null).toBeNull();
    // The athlete plays soccer (a sport on the profile is a setting or a post; the setting is the quiet way).
    const declared = await admin.from('sport_settings').upsert({ profile_id: athlete.id, sport_key: 'soccer', settings: { position: 'forward' } }, { onConflict: 'profile_id,sport_key' });
    expect(declared.error?.message ?? null).toBeNull();
    const { data: handleRow } = await admin.from('profiles').select('handle').eq('id', athlete.id).single();
    const handle = (handleRow as { handle: string | null } | null)?.handle;

    let r = await api.post('/api/videos', { data: { url: `https://www.youtube.com/watch?v=${YT}`, title: `QA Sport Page game ${stamp}`, side: 'league', org_id: league.id, sport_key: 'soccer' } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    videoId = ((await r.json()).video as { id: string }).id;
    r = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'soccer', played_on: '2026-03-07', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(r.status(), await readErrorBody(r)).toBe(200);
    for (const [ms, period] of [[1000, 1], [5000, 2]] as const) {
      r = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: ms, label: 'Goal', event_key: 'goal', side: 1, period, people: [{ profile_id: athlete.id, role: 'scorer' }] } });
      expect(r.status(), await readErrorBody(r)).toBe(201);
    }

    // 1. The athlete opens their own soccer profile: the career, one row per season, the career line under it.
    const page = await athleteCtx.newPage();
    await page.goto(`/athlete/${athlete.id}/sport/soccer`);
    const career = page.locator('[data-sport-level="career"]');
    await expect(career).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-sport-profile="soccer"]')).toBeVisible();
    const seasonRow = career.locator('[data-stat-row="2026"]');
    await expect(seasonRow.locator('[data-stat="goals"]')).toHaveText(/^[2-9]\d*$|^\d{2,}$/);
    await expect(career.locator('[data-stat-row="career"]')).toBeVisible();
    expect(await fitsViewportWidth(page)).toBe(true);

    // 2. A season is a door: the address changes, the season's totals, the split and the game log are there.
    await career.locator('[data-season-link="2026"]').click();
    await expect(page).toHaveURL(/\/sport\/soccer\?season=2026$/);
    const season = page.locator('[data-sport-level="season"][data-season="2026"]');
    await expect(season).toBeVisible();
    await expect(season.locator('[data-sport-split="opponent"]')).toContainText('QA Owls');
    const gameRow = season.locator(`[data-stat-row="film:${videoId}"]`);
    await expect(gameRow).toContainText('vs QA Owls');
    await expect(gameRow).toContainText('Mar 7, 2026');
    await expect(gameRow).toContainText('Game film');
    await expect(gameRow.locator('[data-stat="goals"]')).toHaveText('2');
    expect(await fitsViewportWidth(page)).toBe(true);

    // 2a. A number is a door (PR 4): the season's goals open a reel above the season, without leaving the page.
    await season.locator('[data-stat-row="totals"] [data-stat-door="goals"]').click();
    await expect(page).toHaveURL(/season=2026&stat=goals$/);
    const reel = page.locator('[data-stat-reel="goals"] [data-clip-reel]');
    await expect(reel).toBeVisible({ timeout: 20_000 });
    await expect(reel.locator('[data-clip-reel-now]')).toContainText('QA Hawks vs QA Owls');
    expect(await reel.locator('[data-clip-reel-list] [data-clip]').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-sport-level="season"]')).toBeVisible();
    expect(await fitsViewportWidth(page)).toBe(true);
    await reel.locator('[data-clip-reel-close]').click();
    await expect(page).toHaveURL(/\/sport\/soccer\?season=2026$/);
    await expect(page.locator('[data-clip-reel]')).toHaveCount(0);

    // 2b. A game is a door: the athlete's line, by half, their clips, and the way to the full game.
    await season.locator(`[data-game-link="film:${videoId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`season=2026&game=film%3A${videoId}$`));
    const game = page.locator(`[data-sport-level="game"][data-game="film:${videoId}"]`);
    await expect(game).toBeVisible();
    await expect(game.locator('[data-game-line] [data-stat-row="line"] [data-stat="goals"]')).toHaveText('2');
    await expect(game.locator('[data-game-line] [data-stat-row="p:1"]')).toBeVisible();
    await expect(game.locator('[data-game-full]')).toHaveAttribute('href', `/videos/${videoId}`);
    const clips = game.locator('[data-game-clips] [data-clip-reel]');
    await expect(clips).toHaveAttribute('data-clip-reel-count', '2', { timeout: 20_000 });
    //     The second clip: the player goes to its moment (the first tap starts the player there).
    await clips.locator('[data-clip-reel-list] [data-clip]').nth(1).click();
    await expect(clips).toHaveAttribute('data-clip-reel-index', '1');
    await expect(clips.locator('[data-video-player]')).toHaveAttribute('data-video-start', '5');
    //     The game's own number narrows the clips to that stat; the clip links to its moment on the game's page.
    await game.locator('[data-stat-row="line"] [data-stat-door="goals"]').click();
    await expect(page).toHaveURL(/stat=goals$/);
    const momentHref = await game.locator('[data-clip-reel-game]').getAttribute('href');
    expect(momentHref).toMatch(new RegExp(`^/videos/${videoId}\\?tag=[0-9a-f-]{36}$`));
    expect(await fitsViewportWidth(page)).toBe(true);
    //     Back walks up: the stat, the game, the season.
    await page.goBack();
    await page.goBack();
    await expect(page.locator('[data-sport-level="season"]')).toBeVisible();

    // 2c. The moment's link opens the video AT the moment.
    await page.goto(momentHref!);
    await expect(page.locator('[data-video-player]')).toHaveAttribute('data-video-start', '1', { timeout: 30_000 });
    await page.goto(`/athlete/${athlete.id}/sport/soccer`);
    await page.locator('[data-sport-level="career"] [data-season-link="2026"]').click();
    await expect(page.locator('[data-sport-level="season"]')).toBeVisible({ timeout: 30_000 });

    // 3. Back walks up a level; the season's own address opens the season directly.
    await page.goBack();
    await expect(page.locator('[data-sport-level="career"]')).toBeVisible();
    await page.goto(`/athlete/${athlete.id}/sport/soccer?season=2026`);
    await expect(page.locator('[data-sport-level="season"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-level-up="career"]').click();
    await expect(page.locator('[data-sport-level="career"]')).toBeVisible();

    // 3a. Media on its own (PR 5): the Clips tab — every clip, narrowed by play type, each one linked back to its game and its stat.
    await page.locator('[data-sport-tab="clips"]').click();
    await expect(page).toHaveURL(/\/sport\/soccer\?view=clips$/);
    const browser = page.locator('[data-sport-clips]');
    await expect(browser.locator('[data-clip-reel]')).toHaveAttribute('data-clip-reel-count', '2', { timeout: 20_000 });
    await browser.locator('[data-clips-filter="event"]').selectOption('shot_off_target');
    await expect(page).toHaveURL(/view=clips&event=shot_off_target$/);
    await expect(browser.locator('[data-clips-empty]')).toContainText('No clips match these filters.');
    await browser.locator('[data-clips-filter="event"]').selectOption('goal');
    await expect(browser.locator('[data-clip-reel]')).toHaveAttribute('data-clip-reel-count', '2', { timeout: 20_000 });
    await browser.locator('[data-clips-filter="season"]').selectOption('2026');
    await browser.locator('[data-clips-filter="game"]').selectOption(`film:${videoId}`);
    await expect(page).toHaveURL(new RegExp(`view=clips&season=2026&game=film%3A${videoId}&event=goal$`));
    await expect(browser.locator('[data-clip-origin-game]')).toHaveAttribute('href', new RegExp(`season=2026&game=film%3A${videoId}$`));
    await expect(browser.locator('[data-clip-origin-stat="goals"]')).toHaveAttribute('href', new RegExp(`game=film%3A${videoId}&stat=goals$`));
    expect(await fitsViewportWidth(page)).toBe(true);
    //     Back to the numbers.
    await page.locator('[data-sport-tab="stats"]').click();
    await expect(page.locator('[data-sport-level="career"]')).toBeVisible();

    // 4. A sport the athlete does not have opens the first in their own order; a season that is not there says so.
    await page.goto(`/athlete/${athlete.id}/sport/curling`);
    await expect(page.locator('[data-sport-profile]')).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/curling/);

    // 4a. The profile's own sport strip opens the sport profile (Nov 2026) — one tap from the profile.
    await page.goto(`/athlete`);
    await page.locator('#sports').getByRole('button', { name: 'Soccer stats', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/athlete/${athlete.id}/sport/soccer$`), { timeout: 30_000 });
    await expect(page.locator('[data-sport-level="career"]')).toBeVisible({ timeout: 30_000 });

    // 5. The Stats tab's sport layer has the door.
    await page.goto('/athlete?tab=stats&sport=soccer');
    const door = page.locator('[data-sport-profile-door="soccer"]');
    await expect(door).toBeVisible({ timeout: 30_000 });
    await expect(door).toHaveAttribute('href', `/athlete/${athlete.id}/sport/soccer`);

    // 5a. Hide (311; Tom: the stat still counts). The athlete hides one clip, then the whole game; a follower's totals never move.
    const totalsOf = async (ctx: typeof athleteCtx) => {
      const r = await ctx.request.get(`/api/profile/${athlete.id}/sport-profile?sport=soccer`);
      expect(r.status(), await readErrorBody(r)).toBe(200);
      return (await r.json()) as { career: { totals: Record<string, number>; clips: Record<string, number> }; games: Array<{ key: string; hidden: boolean }> };
    };
    const before = await totalsOf(followerCtx);
    expect(before.games.some(g => g.key === `film:${videoId}`)).toBe(true);
    await page.goto(`/athlete/${athlete.id}/sport/soccer?season=2026&game=film:${videoId}`);
    const mine = page.locator(`[data-sport-level="game"][data-game="film:${videoId}"]`);
    await expect(mine.locator('[data-clip-reel]')).toHaveAttribute('data-clip-reel-count', '2', { timeout: 30_000 });
    await mine.locator('[data-clip-hide-toggle]').click();
    await expect(mine.locator('[data-clip-hidden]')).toBeVisible({ timeout: 20_000 });
    let theirsNow = await totalsOf(followerCtx);
    expect(theirsNow.career.totals).toEqual(before.career.totals);
    expect(theirsNow.career.clips.goals ?? 0).toBe((before.career.clips.goals ?? 0) - 1);
    //     The whole game: gone from the follower's game log and clips; the athlete still sees it, marked; the totals are the same.
    await mine.locator('[data-game-hide-toggle]').click();
    await expect(mine.locator('[data-game-hidden="yes"]')).toBeVisible({ timeout: 20_000 });
    theirsNow = await totalsOf(followerCtx);
    expect(theirsNow.career.totals).toEqual(before.career.totals);
    expect(theirsNow.games.some(g => g.key === `film:${videoId}`)).toBe(false);
    expect((await totalsOf(athleteCtx)).games.find(g => g.key === `film:${videoId}`)).toMatchObject({ hidden: true });
    const strangerHide = await followerCtx.request.post(`/api/profile/${athlete.id}/film-hidden`, { data: { video_id: videoId, hidden: false } });
    expect(strangerHide.status()).toBe(403);
    expect(await fitsViewportWidth(page)).toBe(true);
    //     Shown again: back for everyone.
    await mine.locator('[data-game-hide-toggle]').click();
    await expect(mine.locator('[data-game-hidden="no"]')).toBeVisible({ timeout: 20_000 });
    await mine.locator('[data-clip-hide-toggle]').click();
    await expect(mine.locator('[data-clip-hidden]')).toHaveCount(0, { timeout: 20_000 });
    theirsNow = await totalsOf(followerCtx);
    expect(theirsNow.games.some(g => g.key === `film:${videoId}`)).toBe(true);
    expect(theirsNow.career.clips).toEqual(before.career.clips);

    // 6. A follower, by id and by handle: the same career (a private profile's handle route hands a signed-in viewer to the id route).
    const theirs = await followerCtx.newPage();
    await theirs.goto(`/athlete/${athlete.id}/sport/soccer`);
    await expect(theirs.locator('[data-sport-level="career"] [data-stat-row="2026"]')).toBeVisible({ timeout: 30_000 });
    if (handle) {
      await theirs.goto(`/u/${handle}/sport/soccer?season=2026`);
      await expect(theirs.locator('[data-sport-level="season"][data-season="2026"]')).toBeVisible({ timeout: 30_000 });
      await expect(theirs.locator(`[data-stat-row="film:${videoId}"]`)).toContainText('vs QA Owls');
      expect(await fitsViewportWidth(theirs)).toBe(true);
    }
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('follows').delete().eq('follower_id', follower.id).eq('following_id', athlete.id);
    await admin.from('sport_settings').delete().eq('profile_id', athlete.id).eq('sport_key', 'soccer');
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    await api.dispose();
    await athleteCtx.close();
    await followerCtx.close();
    await deleteQaOrgs(admin, [league.id]);
  }
});
