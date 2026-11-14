import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';
import { seedOwnChannel, withOwnChannel } from './helpers/own-channel';

// Game film round 2, PR 7 (Nov 13 2026) — the Stats tab says when a tagged
// game ALSO has an official line. A league attaches its full-game video to a
// contest and tags an athlete; the same athlete has an official stat line on
// that contest. Their "From game film" row carries the marker and the link
// to the game — exact only: until the athlete has a line on THAT contest
// the read carries no link.
const YT = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
withOwnChannel(['jNQXAC9IVRw']);

interface TaggedGame { video: { id: string }; official_href: string | null }

test('a tagged game attached to a contest with the athlete\'s official line says so on the Stats tab, with the link — at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  await resetRateBucket(admin, 'video-write', owner.id);
  const stamp = `${Date.now()}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Film League ${stamp}`, owner_profile_id: owner.id, sport_key: 'basketball', visibility: 'public' });
  const api = await apiAs('state-b.json');
  const athleteApi = await apiAs('state.json');
  const athleteCtx = await browser.newContext({ storageState: await mintStorageState(athlete), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const videoIds: string[] = [];
  let postId: string | null = null;
  interface Totals { entryCount: number; totals: Record<string, number>; recentActivity: Array<{ id: string; counted: boolean; sameAs: { source: string; href: string | null } | null }>; film: Array<{ videoId: string; counted: boolean; sameAs: { source: string; href: string } | null }> }
  const totalsNow = async (): Promise<Totals> => {
    const r = await athleteApi.get(`/api/sports/stat-lines?profileId=${athlete.id}&sport=basketball`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return (await r.json()) as Totals;
  };
  const eventsNow = async (): Promise<number> => {
    const r = await athleteApi.get(`/api/performance/rollups?profileId=${athlete.id}&sport=basketball`);
    expect(r.status(), await readErrorBody(r)).toBe(200);
    return ((await r.json()) as { rollups: { events: number } | null }).rollups?.events ?? 0;
  };
  const since = new Date().toISOString();
  try {
    const member = await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner', kind: 'follow', status: 'active' });
    expect(member.error?.message ?? null).toBeNull();
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: '2026-27' }).select().single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Hawks ${stamp}` }, { org_id: league.id, name: `Owls ${stamp}` }]).select();
    const { data: comp, error: compError } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'basketball', name: `QA Film Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select().single();
    expect(compError?.message ?? null).toBeNull();
    const { data: entries } = await admin.from('competition_entries').insert(teams!.map(t => ({ competition_id: comp!.id, team_id: t.id, status: 'approved' }))).select();
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'scheduled' }).select().single();
    const contestId = contest!.id as string;
    await admin.from('contest_participants').insert([
      { contest_id: contestId, entry_id: entries![0].id, side: 'home' },
      { contest_id: contestId, entry_id: entries![1].id, side: 'away' },
    ]);
    // What this account already has in the sport, before anything here.
    const base = await totalsNow();
    const basePoints = base.totals.points ?? 0;
    const baseEvents = await eventsNow();
    await seedOwnChannel(admin, { orgId: league.id }, owner.id);
    // The league's game, attached to the contest; the athlete is tagged (a league tags anyone).
    let res = await api.post('/api/videos', { data: { url: YT, title: `QA Film game ${stamp}`, side: 'league', org_id: league.id, sport_key: 'basketball', contest_id: contestId } });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    const attached = ((await res.json()).video as { id: string }).id;
    videoIds.push(attached);
    res = await api.put(`/api/videos/${attached}/game`, { data: { sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'QA Hawks' }, side2: { name: 'QA Owls' }, coverage: 'full', stats_hidden: false } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await api.post(`/api/videos/${attached}/highlights`, { data: { start_ms: 1000, label: 'Three', event_key: 'fg3_made', side: 1, period: 1, people: [{ profile_id: athlete.id, role: 'scorer' }] } });
    expect(res.status(), await readErrorBody(res)).toBe(201);

    // 0. Nov 14: a league's fully tagged, dated game is VERIFIED film — it counts. One more game, three more points, in the totals and the tiles.
    let now = await totalsNow();
    expect(now.film.find(f => f.videoId === attached)).toMatchObject({ counted: true, sameAs: null });
    expect(now.entryCount).toBe(base.entryCount + 1);
    expect(now.totals.points).toBe(basePoints + 3);
    expect(await eventsNow()).toBe(baseEvents + 1);
    //    The athlete ALSO posted that game themselves (the same date, typed as 9 points): the club's film wins; still one game, three points.
    const posted = await athleteApi.post('/api/posts', { data: { caption: `QA film same game ${stamp}`, visibility: 'public', postType: 'basketball', stats_data: { type: 'stat_line', sport_key: 'basketball', date: '2026-11-01', opponent: 'QA Owls', result: 'W', stats: { points: 9 } } } });
    expect(posted.ok(), await readErrorBody(posted)).toBe(true);
    postId = ((await posted.json()).post as { id: string }).id;
    now = await totalsNow();
    expect(now.recentActivity.find(r => r.id === postId)).toMatchObject({ counted: false, sameAs: { source: 'film', href: `/videos/${attached}` } });
    expect(now.entryCount).toBe(base.entryCount + 1);
    expect(now.totals.points).toBe(basePoints + 3);
    await expect.poll(async () => ((await admin.from('athlete_performances').select('id').eq('source_id', postId!)).data ?? []).length, { timeout: 20_000 }).toBe(1);
    expect(await eventsNow()).toBe(baseEvents + 1);

    // 1. The read. No official line for this athlete on the contest yet: no link.
    const linkOf = async () => {
      const r = await athleteApi.get(`/api/videos/tagged?profileId=${athlete.id}`);
      expect(r.status(), await readErrorBody(r)).toBe(200);
      return ((await r.json()).games as TaggedGame[]).find(g => g.video.id === attached)!.official_href;
    };
    expect(await linkOf()).toBeNull();
    //    The athlete's OFFICIAL line on that contest → the link to the game.
    const line = await admin.from('contest_stat_lines').insert({ contest_id: contestId, team_id: teams![0].id, profile_id: athlete.id, stats: { points: 5 }, provenance: 'league_verified', entered_by: owner.id });
    expect(line.error?.message ?? null).toBeNull();
    expect(await linkOf()).toBe(`/event/${contestId}`);
    //    The official line (5 points) is now the one that counts: the film of that contest steps aside, and the athlete's post of that day
    //    with it (the film carries the date the undated contest lacks). Still ONE game.
    now = await totalsNow();
    expect(now.film.find(f => f.videoId === attached)).toMatchObject({ counted: false, sameAs: { source: 'official' } });
    expect(now.recentActivity.find(r => r.id === postId)).toMatchObject({ counted: false, sameAs: { source: 'official' } });
    expect(now.entryCount).toBe(base.entryCount + 1);
    expect(now.totals.points).toBe(basePoints + 5);

    // 2. On the athlete's Stats tab at phone width: the marker and its link on that row.
    const page = await athleteCtx.newPage();
    await page.goto('/athlete?tab=stats');
    const row = page.locator(`[data-game-film-row="${attached}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    //    Nov 14: a league's fully tagged game is VERIFIED film, under its own heading.
    await expect(row).toHaveAttribute('data-game-film-standing', 'verified');
    await expect(page.locator('[data-game-film-group="verified"]').locator(`[data-game-film-row="${attached}"]`)).toHaveCount(1);
    await expect(page.locator('[data-game-film-group="recreational"]')).toHaveCount(0);
    const marker = row.locator('[data-game-film-official]');
    await expect(marker).toContainText('The official line is the one that counts.');
    await expect(row.locator('[data-game-film-counted="no"]')).toContainText('the official line', { timeout: 20_000 });
    await expect(row.locator('[data-game-film-counted="yes"]')).toHaveCount(0);
    await expect(marker.getByRole('link', { name: 'open the game' })).toHaveAttribute('href', `/event/${contestId}`);
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    if (postId) await athleteApi.delete(`/api/posts/${postId}`).catch(() => undefined);
    for (const id of videoIds) await api.delete(`/api/videos/${id}`).catch(() => undefined);
    await admin.from('notifications').delete().eq('user_id', athlete.id).eq('type', 'tag').gte('created_at', since);
    await api.dispose();
    await athleteApi.dispose();
    await athleteCtx.close();
    await deleteQaOrgs(admin, [league.id]);
  }
});
