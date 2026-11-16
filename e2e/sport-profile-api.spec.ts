import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, E2E_TARGET, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Sprint 4 PR 2 (Nov 2026) — the athlete's sport profile, the reads. A league
// tags an athlete in two full games; the profile answers Career → Season →
// Game → Play from those tags alone: the numbers are the Stats tab's, every
// stat names the clips behind it, a reel crosses the two videos in the order
// the season happened, a spoiler-free game counts but keeps its line and its
// clips until the viewer asks, and a block closes all of it.
// (Production links only YouTube's first upload: the second game is staging's.)
const YT1 = 'jNQXAC9IVRw';
const YT2 = 'aqz-KE-bpKQ';
withOwnChannel([YT1, YT2]);

interface Row { key: string; source: string; date: string | null; season: string | null; opponent: string | null; stats: Record<string, number>; counted: boolean; standing: string | null; held: boolean; clips: number; byPeriod: Record<string, Record<string, number>> }
interface Profile { supported: boolean; career: { games: number; totals: Record<string, number>; clips: Record<string, number> }; seasons: Array<{ key: string; games: number; totals: Record<string, number> }>; games: Row[]; held: number; can_edit: boolean; columns: Array<{ key: string }> }
interface Clip { id: string; videoId: string; youtubeId: string; startMs: number; statKeys: string[]; gameKey: string; gameDate: string | null; period: number | null }
interface Clips { clips: Clip[]; next: number | null; total: number }

test('the sport profile reads career, season, game and play from the tags; the numbers are the Stats tab\'s; spoilers and blocks hold', async () => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  const stranger = loadQaUser('user-c.json'); // a follower of the athlete, no part in the league
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Sport Profile League ${stamp}`, owner_profile_id: owner.id, sport_key: 'soccer', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const athleteApi = await apiAs('state.json');
  const strangerApi = await apiAs('state-c.json');
  const videoIds: string[] = [];
  const since = new Date().toISOString();
  const base = `/api/profile/${athlete.id}`;
  const profileAs = async (as: typeof api, extra = ''): Promise<Profile> => {
    const r = await as.get(`${base}/sport-profile?sport=soccer${extra}`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return (await r.json()) as Profile;
  };
  const clipsAs = async (as: typeof api, query: string): Promise<Clips> => {
    const r = await as.get(`${base}/sport-clips?sport=soccer${query}`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return (await r.json()) as Clips;
  };
  const statTab = async (): Promise<{ entryCount: number; totals: Record<string, number> }> => {
    const r = await athleteApi.get(`/api/sports/stat-lines?profileId=${athlete.id}&sport=soccer`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return (await r.json()) as { entryCount: number; totals: Record<string, number> };
  };
  const tagIds: string[] = [];
  const tag = async (videoId: string, data: Record<string, unknown>) => {
    const r = await api.post(`/api/videos/${videoId}/highlights`, { data });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    tagIds.push(((await r.json()).highlight as { id: string }).id);
  };
  const game = async (yt: string, title: string, body: Record<string, unknown>): Promise<string> => {
    let r = await api.post('/api/videos', { data: { url: `https://www.youtube.com/watch?v=${yt}`, title, side: 'league', org_id: league.id, sport_key: 'soccer' } });
    expect(r.status(), await readErrorBody(r)).toBe(201);
    const id = ((await r.json()).video as { id: string }).id;
    videoIds.push(id);
    r = await api.put(`/api/videos/${id}/game`, { data: { sport_key: 'soccer', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', ...body } });
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return id;
  };
  try {
    const member = await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' });
    expect(member.error?.message ?? null).toBeNull();
    await seedOwnChannel(admin, { orgId: league.id }, owner.id);
    // A QA profile is private: the stranger is let in the way a person is — an accepted follow.
    const follow = await admin.from('follows').insert({ follower_id: stranger.id, following_id: athlete.id, status: 'accepted' });
    expect(follow.error?.message ?? null).toBeNull();
    const before = await profileAs(athleteApi);
    expect(before.supported).toBe(true);
    const goals0 = before.career.totals.goals ?? 0;
    const games0 = before.career.games;
    const clips0 = before.career.clips.goals ?? 0;

    // Game one: open stats. Two goals (one in each half) and a shot wide.
    const one = await game(YT1, `QA Sport Profile one ${stamp}`, { played_on: '2026-03-07', stats_hidden: false });
    await tag(one, { start_ms: 5000, label: 'Second', event_key: 'goal', side: 1, period: 2, people: [{ profile_id: athlete.id, role: 'scorer' }] });
    await tag(one, { start_ms: 1000, label: 'First', event_key: 'goal', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'scorer' }] });
    await tag(one, { start_ms: 3000, label: 'Wide', event_key: 'shot_off_target', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'shooter' }] });

    // 1. Career, season, game — and the Stats tab agrees, key for key.
    let mine = await profileAs(athleteApi);
    expect(mine.can_edit).toBe(true);
    expect(mine.career.games).toBe(games0 + 1);
    expect(mine.career.totals.goals).toBe(goals0 + 2);
    const tab = await statTab();
    expect(mine.career.games).toBe(tab.entryCount);
    expect(mine.career.totals).toEqual(tab.totals);
    expect(mine.seasons.find(s => s.key === '2026')!.totals.goals).toBeGreaterThanOrEqual(2);
    const row = mine.games.find(g => g.key === `film:${one}`)!;
    expect(row).toMatchObject({ source: 'film', date: '2026-03-07', season: '2026', opponent: 'QA Owls', counted: true, standing: 'verified', held: false, clips: 3 });
    expect(row.stats).toMatchObject({ goals: 2, shots: 3, shots_on_target: 2 });
    expect(row.byPeriod['1']).toMatchObject({ goals: 1, shots: 2 });
    expect(row.byPeriod['2']).toMatchObject({ goals: 1, shots: 1 });
    expect(mine.columns.map(c => c.key)).toContain('goals');
    // The number is a door: two clips are behind "goals".
    expect(mine.career.clips.goals).toBe(clips0 + 2);

    // 2. Play: the clips behind the stat, in game order; narrowed by game and period.
    let reel = await clipsAs(athleteApi, `&stat=goals&game=film:${one}`);
    expect(reel.clips.map(c => c.startMs)).toEqual([1000, 5000]);
    expect(reel.clips[0]).toMatchObject({ videoId: one, youtubeId: YT1, gameKey: `film:${one}`, gameDate: '2026-03-07' });
    expect(reel.clips[0].statKeys).toEqual(expect.arrayContaining(['goals', 'shots']));
    expect((await clipsAs(athleteApi, `&game=film:${one}&period=2`)).clips.map(c => c.startMs)).toEqual([5000]);
    expect((await clipsAs(athleteApi, `&game=film:${one}`)).total).toBe(3);
    expect((await athleteApi.get(`${base}/sport-clips?sport=soccer&game=nope`)).status()).toBe(400);

    if (E2E_TARGET !== 'prod') {
      // Game two, a month later: spoiler-free. One goal.
      const two = await game(YT2, `QA Sport Profile two ${stamp}`, { played_on: '2026-04-11', stats_hidden: true });
      await tag(two, { start_ms: 2000, label: 'Late', event_key: 'goal', side: 1, period: 2, people: [{ profile_id: athlete.id, role: 'scorer' }] });

      // 3. The athlete sees their own game; a season reel crosses the two videos in the order it happened.
      mine = await profileAs(athleteApi);
      expect(mine.career.totals.goals).toBe(goals0 + 3);
      expect(mine.games.find(g => g.key === `film:${two}`)).toMatchObject({ held: false, clips: 1 });
      reel = await clipsAs(athleteApi, '&stat=goals&season=2026');
      const ours = reel.clips.filter(c => c.videoId === one || c.videoId === two);
      expect(ours.map(c => [c.youtubeId, c.startMs])).toEqual([[YT1, 1000], [YT1, 5000], [YT2, 2000]]);

      // 4. A stranger: the total counts the spoiler-free game, its line and its clips stay on the server until they ask.
      const theirs = await profileAs(strangerApi);
      expect(theirs.can_edit).toBe(false);
      expect(theirs.career.totals.goals).toBe(mine.career.totals.goals);
      expect(theirs.held).toBeGreaterThanOrEqual(1);
      expect(theirs.games.find(g => g.key === `film:${two}`)).toMatchObject({ held: true, counted: true, clips: 0, stats: {}, byPeriod: {} });
      expect((await clipsAs(strangerApi, '&stat=goals&season=2026')).clips.some(c => c.videoId === two)).toBe(false);
      const shown = await profileAs(strangerApi, '&spoilers=show');
      expect(shown.games.find(g => g.key === `film:${two}`)).toMatchObject({ held: false, clips: 1 });
      expect(shown.games.find(g => g.key === `film:${two}`)!.stats.goals).toBe(1);
      expect((await clipsAs(strangerApi, '&stat=goals&season=2026&spoilers=show')).clips.some(c => c.videoId === two)).toBe(true);
    }

    // 5. A block, either way, closes the sport profile, its clips and the tagged list — the same 404.
    const block = await admin.from('user_blocks').insert({ blocker_id: athlete.id, blocked_id: stranger.id });
    expect(block.error?.message ?? null).toBeNull();
    try {
      expect((await strangerApi.get(`${base}/sport-profile?sport=soccer`)).status()).toBe(404);
      expect((await strangerApi.get(`${base}/sport-clips?sport=soccer`)).status()).toBe(404);
      expect((await strangerApi.get(`/api/videos/tagged?profileId=${athlete.id}`)).status()).toBe(404);
      //    …and (Nov 2026) the profile itself and the Stats tab's older routes: a profile they cannot view, never "blocked".
      expect((await strangerApi.get(`/api/sports/stat-lines?profileId=${athlete.id}&sport=soccer`)).status()).toBe(403);
      expect((await strangerApi.get(`/api/performance/rollups?profileId=${athlete.id}&sport=soccer`)).status()).toBe(403);
      expect(((await (await strangerApi.get(`/api/profile?id=${athlete.id}`)).json()) as { canView?: boolean }).canView).toBe(false);
    } finally {
      await admin.from('user_blocks').delete().eq('blocker_id', athlete.id).eq('blocked_id', stranger.id);
    }
    expect((await strangerApi.get(`${base}/sport-profile?sport=soccer`)).status()).toBe(200);
    expect((await strangerApi.get(`/api/sports/stat-lines?profileId=${athlete.id}&sport=soccer`)).status()).toBe(200);
    expect(((await (await strangerApi.get(`/api/profile?id=${athlete.id}`)).json()) as { canView?: boolean }).canView).toBe(true);
    // A sport with no stat sheet here answers that plainly.
    const golf = await athleteApi.get(`${base}/sport-profile?sport=golf`);
    expect(((await golf.json()) as { supported: boolean }).supported).toBe(false);
  } finally {
    await admin.from('user_blocks').delete().eq('blocker_id', athlete.id).eq('blocked_id', stranger.id);
    await admin.from('follows').delete().eq('follower_id', stranger.id).eq('following_id', athlete.id);
    for (const id of videoIds) await api.delete(`/api/videos/${id}`).catch(() => undefined);
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    await api.dispose();
    await athleteApi.dispose();
    await strangerApi.dispose();
    await deleteQaOrgs(admin, [league.id]);
  }
});
