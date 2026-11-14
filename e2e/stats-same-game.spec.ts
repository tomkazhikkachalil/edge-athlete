import { test, expect } from './helpers/test';
import { createQaOrg, deleteQaOrgs, rosterSeasonId } from './helpers/org';
import { adminClient, apiAs, bypassHeaders, loadQaUser, mintStorageState, readErrorBody } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';

// One game, counted once (Nov 14 2026). A league enters an athlete's
// OFFICIAL line for a game; the athlete also posted that game themselves
// (the same date), and another game the next day. The Stats tab counts TWO
// games, not three — the official line and the other day's post — in the
// season totals AND in the career tiles; the posted copy stays in the log,
// marked "not counted" with the link to the official line.
test('an official line and the athlete\'s own post of the same game count once — totals, tiles and the marked row at 375 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const athlete = loadQaUser('user.json');
  const stamp = `${Date.now()}`;
  const league = await createQaOrg(admin, 'league', { name: `QA Same Game League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id, visibility: 'public' });
  const ownerApi = await apiAs('state-b.json');
  const athleteApi = await apiAs('state.json');
  const ctx = await browser.newContext({ storageState: await mintStorageState(athlete), extraHTTPHeaders: bypassHeaders(), viewport: { width: 375, height: 800 } });
  const postIds: string[] = [];
  try {
    await admin.from('memberships').insert({ org_id: league.id, profile_id: owner.id, role: 'owner' });
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: '2026-27' }).select().single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Blazers ${stamp}` }, { org_id: league.id, name: `Comets ${stamp}` }]).select();
    const home = teams!.find(t => (t.name as string).startsWith('Blazers'))!;
    const away = teams!.find(t => (t.name as string).startsWith('Comets'))!;
    const rostered = await admin.from('memberships').insert({ org_id: league.id, profile_id: athlete.id, kind: 'roster', status: 'active', scope_type: 'team', scope_id: home.id, season_id: await rosterSeasonId(admin, league.id) });
    expect(rostered.error?.message ?? null).toBeNull();
    const { data: comp, error: compError } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `QA Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select().single();
    expect(compError?.message ?? null).toBeNull();
    const { data: entries } = await admin.from('competition_entries').insert([{ competition_id: comp!.id, team_id: home.id, status: 'approved' }, { competition_id: comp!.id, team_id: away.id, status: 'approved' }]).select();
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'scheduled', scheduled_at: '2026-10-20T18:00:00Z' }).select().single();
    const contestId = contest!.id as string;
    await admin.from('contest_participants').insert([
      { contest_id: contestId, entry_id: entries!.find(e => e.team_id === home.id)!.id, side: 'home' },
      { contest_id: contestId, entry_id: entries!.find(e => e.team_id === away.id)!.id, side: 'away' },
    ]);

    // The league's official line: 2 goals, 1 assist on Oct 20.
    let res = await ownerApi.post(`/api/leagues/${league.id}/competitions/${comp!.id}/stat-lines`, { data: { contestId, lines: [{ profileId: athlete.id, teamId: home.id, stats: { goals: 2, assists: 1 } }] } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The athlete's own posts: the SAME game (Oct 20, typed as 1 goal) and another game on Oct 21 (3 goals).
    for (const [date, goals] of [['2026-10-20', 1], ['2026-10-21', 3]] as const) {
      res = await athleteApi.post('/api/posts', { data: { caption: `QA same game ${stamp} ${date}`, visibility: 'public', postType: 'ice_hockey', stats_data: { type: 'stat_line', sport_key: 'ice_hockey', date, opponent: `Comets ${stamp}`, result: 'W', stats: { goals, assists: 0 } } } });
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      postIds.push(((await res.json()).post as { id: string }).id);
    }
    const [sameGamePost, otherPost] = postIds;

    // 1. The season totals: two games, 2 + 3 goals — not three games and six.
    res = await athleteApi.get(`/api/sports/stat-lines?profileId=${athlete.id}&sport=ice_hockey`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const body = (await res.json()) as { entryCount: number; totals: Record<string, number>; recentActivity: Array<{ id: string; counted: boolean; sameAs: { source: string; href: string | null } | null }>; official: Array<{ contestId: string; counted: boolean; href: string }> };
    expect(body.entryCount).toBe(2);
    expect(body.totals.goals).toBe(5);
    expect(body.totals.assists).toBe(1);
    const officialRow = body.official.find(o => o.contestId === contestId)!;
    expect(officialRow.counted).toBe(true);
    expect(body.recentActivity.find(r => r.id === sameGamePost)).toMatchObject({ counted: false, sameAs: { source: 'official', href: officialRow.href } });
    expect(body.recentActivity.find(r => r.id === otherPost)).toMatchObject({ counted: true, sameAs: null });

    // 2. The career tiles read the fact table: both posts and the contest line have their rows, and ONE of them is not counted
    //    (whatever else this account already has in the sport).
    const rows = async () => ((await admin.from('athlete_performances').select('id, source_id, contest_id').eq('profile_id', athlete.id).eq('sport_key', 'ice_hockey').neq('dispute_status', 'disputed')).data ?? []) as Array<{ id: string; source_id: string; contest_id: string | null }>;
    await expect.poll(async () => { const r = await rows(); return postIds.every(id => r.some(x => x.source_id === id)) && r.some(x => x.contest_id === contestId); }, { timeout: 20_000 }).toBe(true);
    const total = (await rows()).length;
    res = await athleteApi.get(`/api/performance/rollups?profileId=${athlete.id}&sport=ice_hockey`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(((await res.json()) as { rollups: { events: number } }).rollups.events).toBe(total - 1);

    // 3. On the athlete's Stats tab at phone width: the posted copy is marked, with the link; the other game is not.
    const page = await ctx.newPage();
    await page.goto(`/athlete/${athlete.id}?tab=stats&sport=ice_hockey`);
    const marked = page.locator(`[data-stat-log-row="${sameGamePost}"]`);
    // The sport layer opens on a summary; the log is behind "Full breakdown" (a tap before hydration is swallowed — tap until it opens).
    await expect(async () => {
      if (!(await marked.isVisible())) await page.getByRole('button', { name: 'Full breakdown' }).click();
      await expect(marked).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(marked).toHaveAttribute('data-stat-counted', 'no');
    await expect(marked.locator('[data-stat-not-counted]')).toContainText('Not counted');
    await expect(marked.locator('[data-stat-not-counted] a')).toHaveAttribute('href', officialRow.href);
    await expect(page.locator(`[data-stat-log-row="${otherPost}"]`)).toHaveAttribute('data-stat-counted', 'yes');
    expect(await fitsViewportWidth(page)).toBe(true);
  } finally {
    for (const id of postIds) await athleteApi.delete(`/api/posts/${id}`).catch(() => undefined);
    await ownerApi.dispose();
    await athleteApi.dispose();
    await ctx.close();
    await deleteQaOrgs(admin, [league.id]);
  }
});
