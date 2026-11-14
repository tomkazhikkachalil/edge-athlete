import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 1 (Nov 13 2026) — the game's details inside the Full
// game flow. Details carries "This is a game": on, the same fields as the
// video page's card open (the sport already chosen is the game's), a game
// without a sport cannot go on, and Save makes the video AND its game in one
// go. A side's team link is refused on a profile's video (only a club's or
// league's own teams).
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

test('@mobile the Full game flow saves the game with the video: the switch, the fields, the refusal without a sport, the page with the title line', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const user = loadQaUser('user.json');
  for (const bucket of ['video-write', 'video-lookup'] as const) await resetRateBucket(admin, bucket, user.id);
  const api = await apiAs('state.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(user), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  try {
    await seedOwnChannel(admin, { profileId: user.id }, user.id);
    await admin.from('videos').delete().eq('profile_id', user.id).eq('provider_video_id', 'jNQXAC9IVRw');
    const page = await ctx.newPage();
    await page.goto('/videos/new');
    await page.locator('[data-new-video-url]').fill(YT);
    await expect(page.locator('[data-step-next]')).toBeEnabled({ timeout: 20_000 });
    await page.locator('[data-step-next]').click();

    // Details: the plain sport, then the switch — the game takes that sport and the plain select steps aside.
    await page.locator('[data-new-video-title]').fill(`QA Flow game ${Date.now()}`);
    await page.locator('[data-new-video-sport]').selectOption('basketball');
    await expect(page.locator('[data-video-game-fields]')).toHaveCount(0);
    await page.locator('[data-new-video-is-game]').check();
    await expect(page.locator('[data-video-game-fields]')).toBeVisible();
    await expect(page.locator('[data-new-video-sport]')).toHaveCount(0);
    await expect(page.locator('[data-video-game-sport]')).toHaveValue('basketball');
    // A game needs its sport: without one the step says so.
    await page.locator('[data-video-game-sport]').selectOption('');
    await expect(page.locator('[data-step-next]')).toBeDisabled();
    await expect(page.locator('[data-step-refusal]')).toContainText('Choose the sport of the game');
    await page.locator('[data-video-game-sport]').selectOption('basketball');
    await page.locator('[data-video-game-side="1"]').fill('QA Hawks');
    await page.locator('[data-video-game-side="2"]').fill('QA Owls');
    await page.locator('[data-video-game-date]').fill('2026-11-01');
    // A profile's video has no teams to pick.
    await expect(page.locator('[data-video-game-team]')).toHaveCount(0);
    expect(await fitsViewportWidth(page)).toBe(true);
    await page.locator('[data-step-next]').click();
    await page.locator('[data-new-video-where] input[name="owner"]').first().check();
    await page.locator('[data-step-finish]').click();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/videos\/[0-9a-f-]{36}$/);
    videoId = page.url().split('/').pop()!;

    // The page opens as a game already.
    await expect(page.locator('[data-video-game-title]')).toHaveText('QA Hawks vs QA Owls', { timeout: 20_000 });
    let res = await api.get(`/api/videos/${videoId}/game`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).game).toMatchObject({ sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks', team_id: null }, side2: { name: 'QA Owls', team_id: null }, coverage: 'highlights', stats_hidden: true });
    res = await api.get(`/api/videos/${videoId}`);
    expect((await res.json()).video).toMatchObject({ sport_key: 'basketball' });

    // A team link on a profile's video is refused — whatever the id.
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: null, side1: { name: 'QA Hawks', team_id: '11111111-1111-4111-8111-111111111111' }, side2: null, coverage: 'highlights', stats_hidden: true } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('own teams');
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('videos').delete().eq('profile_id', user.id).eq('provider_video_id', 'jNQXAC9IVRw');
    await admin.from('youtube_connections').delete().eq('profile_id', user.id);
    await api.dispose();
    await ctx.close();
  }
});

test('a club\'s own game: a side is one of ITS teams (the name fills in); another organization\'s team is refused — at 375 px', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const club = await createQaOrg(admin, 'club', { name: `QA Game Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  const other = await createQaOrg(admin, 'club', { name: `QA Other Club ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  await admin.from('memberships').insert([
    { org_id: club.id, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { org_id: other.id, profile_id: owner.id, role: 'owner', kind: 'follow' },
  ]);
  const api = await apiAs('state-b.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(owner), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  let videoId: string | null = null;
  try {
    const made = await admin.from('teams').insert([
      { org_id: club.id, name: `QA Hawks ${stamp}` },
      { org_id: club.id, name: `QA Owls ${stamp}` },
      { org_id: other.id, name: `QA Strangers ${stamp}` },
    ]).select('id, org_id, name');
    expect(made.error?.message ?? null).toBeNull();
    const teams = (made.data ?? []) as Array<{ id: string; org_id: string; name: string }>;
    const hawks = teams.find(t => t.name.startsWith('QA Hawks'))!;
    const strangers = teams.find(t => t.org_id === other.id)!;
    await seedOwnChannel(admin, { orgId: club.id }, owner.id);
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Club game ${stamp}`, side: 'club', org_id: club.id, sport_key: 'basketball' } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    videoId = ((await res.json()).video as { id: string }).id;

    // Another organization's team is not this video's to link — though the same person owns both clubs.
    res = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'basketball', played_on: null, side1: { team_id: strangers.id }, side2: null, coverage: 'highlights', stats_hidden: true } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('own teams');

    // On the page: the form offers the club's two teams and nobody else's; picking one names the side.
    const page = await ctx.newPage();
    await page.goto(`/videos/${videoId}`);
    await page.locator('[data-video-game-start]').click();
    const pick = page.locator('[data-video-game-team="1"]');
    await expect(pick).toBeVisible({ timeout: 20_000 });
    await expect(pick.locator('option')).toHaveCount(3);
    await expect(pick).not.toContainText('QA Strangers');
    await pick.selectOption(hawks.id);
    await expect(page.locator('[data-video-game-side="1"]')).toHaveValue(hawks.name);
    await page.locator('[data-video-game-side="2"]').fill('Visitors');
    expect(await fitsViewportWidth(page)).toBe(true);
    await page.locator('[data-video-game-save]').click();
    await expect(page.locator('[data-video-game-title]')).toHaveText(`${hawks.name} vs Visitors`, { timeout: 20_000 });
    res = await api.get(`/api/videos/${videoId}/game`);
    expect((await res.json()).game).toMatchObject({ side1: { name: hawks.name, team_id: hawks.id }, side2: { name: 'Visitors', team_id: null } });
    // Editing again keeps the link.
    await page.locator('[data-video-game-edit]').click();
    await expect(page.locator('[data-video-game-team="1"]')).toHaveValue(hawks.id);
  } finally {
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await api.dispose();
    await ctx.close();
    await deleteQaOrgs(admin, [club.id, other.id]);
  }
});
