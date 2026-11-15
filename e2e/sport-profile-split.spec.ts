import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 4 PR 7a (Nov 2026) — "these are two different games" in the sport
// profile's game log. A league's film and the athlete's own post share a
// date: the film counts, the post is marked as the same game. The athlete
// says they are two games — both count — and takes it back.
const YT = 'jNQXAC9IVRw';
withOwnChannel([YT]);

interface Row { key: string; counted: boolean; sameAs: string | null; canSplit: boolean; splitFrom: string | null }
interface Profile { career: { games: number; totals: Record<string, number> }; games: Row[] }

test('a film game and the athlete\'s own post of the same date: one game, split into two by the athlete, and joined again — at 375 px @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Split League ${stamp}`, owner_profile_id: owner.id, sport_key: 'soccer', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const athleteApi = await apiAs('state.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(athlete), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const since = new Date().toISOString();
  let videoId: string | null = null;
  let postId: string | null = null;
  const read = async (): Promise<Profile> => {
    const r = await athleteApi.get(`/api/profile/${athlete.id}/sport-profile?sport=soccer`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return (await r.json()) as Profile;
  };
  try {
    const member = await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' });
    expect(member.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: league.id }, owner.id);
    const base = await read();

    let r = await api.post('/api/videos', { data: { url: `https://www.youtube.com/watch?v=${YT}`, title: `QA Split game ${stamp}`, side: 'league', org_id: league.id, sport_key: 'soccer' } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    videoId = ((await r.json()).video as { id: string }).id;
    r = await api.put(`/api/videos/${videoId}/game`, { data: { sport_key: 'soccer', played_on: '2026-05-09', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(r.status(), await readErrorBody(r)).toBe(200);
    r = await api.post(`/api/videos/${videoId}/highlights`, { data: { start_ms: 1000, label: 'Goal', event_key: 'goal', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'scorer' }] } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    const posted = await athleteApi.post('/api/posts', { data: { caption: `QA split same day ${stamp}`, visibility: 'public', postType: 'soccer', stats_data: { type: 'stat_line', sport_key: 'soccer', date: '2026-05-09', opponent: 'QA Kites', result: 'W', stats: { goals: 3 } } } });
    expect(posted.ok(), await readErrorBody(posted)).toBe(true);
    postId = ((await posted.json()).post as { id: string }).id;

    // 1. One game: the league's film counts, the athlete's post of that day is the same game — and may be split.
    let now = await read();
    expect(now.career.games).toBe(base.career.games + 1);
    expect(now.career.totals.goals).toBe((base.career.totals.goals ?? 0) + 1);
    expect(now.games.find(g => g.key === `post:${postId}`)).toMatchObject({ counted: false, sameAs: `film:${videoId}`, canSplit: true, splitFrom: null });

    // 2. On the page: the row says so, and the athlete says they are two games.
    const page = await ctx.newPage();
    await page.goto(`/athlete/${athlete.id}/sport/soccer?season=2026`);
    const row = page.locator(`[data-stat-row="post:${postId}"]`);
    await expect(row).toContainText('Not counted — the same game as the club\'s game film', { timeout: 30_000 });
    await expect(row.locator('[data-stat-not-counted] a')).toHaveAttribute('href', new RegExp(`season=2026&game=film%3A${videoId}$`));
    await row.locator('[data-stat-split]').click();
    await expect(row.locator('[data-stat-split-done]')).toContainText('Counted as its own game.', { timeout: 20_000 });
    now = await read();
    expect(now.career.games).toBe(base.career.games + 2);
    expect(now.career.totals.goals).toBe((base.career.totals.goals ?? 0) + 4);
    expect(now.games.find(g => g.key === `post:${postId}`)).toMatchObject({ counted: true, sameAs: null, splitFrom: `film:${videoId}` });
    expect(await fitsViewportWidth(page)).toBe(true);

    // 3. Taken back: one game again.
    await row.locator('[data-stat-split-undo]').click();
    await expect(row.locator('[data-stat-split]')).toBeVisible({ timeout: 20_000 });
    now = await read();
    expect(now.career.games).toBe(base.career.games + 1);
    expect(now.career.totals.goals).toBe((base.career.totals.goals ?? 0) + 1);
  } finally {
    if (postId) await athleteApi.delete(`/api/posts/${postId}`).catch(() => undefined);
    if (videoId) await api.delete(`/api/videos/${videoId}`).catch(() => undefined);
    await admin.from('stat_game_distinct').delete().eq('profile_id', athlete.id).eq('sport_key', 'soccer');
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    await api.dispose();
    await athleteApi.dispose();
    await ctx.close();
    await deleteQaOrgs(admin, [league.id]);
  }
});
