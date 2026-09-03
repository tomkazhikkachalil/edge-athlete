import { test, expect, request } from '@playwright/test';
import { E2E_BASE_URL, adminClient, apiAs, createQaUser, deleteQaUser, loadQaUser, mintStorageState, resetRateBucket } from './helpers/qa-user';

// Program 11 L2 — a PRIVATE league on the public site (the twin of
// club-private-gates, the SAME rule by decision). Identity and the join
// door stay; standings, the week, players, leaders, teams, divisions and
// the gallery render "Members only" panels (a stable 200 — never a session
// read); the public standings API and the SSR twin answer the empty state;
// members read the full payload through /standings/mine (session-gated,
// private cache) and the in-app league page; the league GET hides the
// member list from outsiders; search marks the league Private; the
// sitemap keeps the public subpages only; flipping to public revalidates.
// 375px.

const stamp = Math.random().toString(36).slice(2, 8);

async function readErrorBody(res: { text: () => Promise<string> }): Promise<string> {
  return (await res.text()).slice(0, 300);
}

test('private league: panels on the site, empty public standings, members read /mine, outsiders see no names, search chip, sitemap, flip back; 375px', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json'); // a member
  const stranger = await createQaUser({ firstName: 'Sky', lastName: 'Outsidertest' });
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-competitions', owner.id);
  const probe = await admin.from('leagues').select('visibility').limit(1);
  test.skip(!!probe.error, `membership columns missing — run migration 177 (${probe.error?.message})`);

  const { data: league } = await admin
    .from('leagues')
    .insert({ name: `QA Private League ${stamp}`, owner_profile_id: owner.id, sport_key: 'golf', visibility: 'private', join_policy: 'approval' })
    .select('id')
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'follow' },
  ]);
  const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: `2026 ${stamp}` }).select('id').single();
  const { data: venue } = await admin.from('venues').insert({ league_id: leagueId, name: `QA Private Links ${stamp}` }).select('id').single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Private Ladder ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_points',
      config: { golf: { pick: 'first', points: 'pga', score: 'gross' } },
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const competitionId = comp!.id as string;
  const { data: entries } = await admin
    .from('competition_entries')
    .insert([
      { competition_id: competitionId, profile_id: owner.id, status: 'approved' },
      { competition_id: competitionId, profile_id: alpha.id, status: 'approved' },
    ])
    .select('id, profile_id');
  const entryOf = new Map(entries!.map(e => [e.profile_id as string, e.id as string]));

  const ownerApi = await apiAs('state-b.json');
  const alphaApi = await apiAs('state.json');
  const strangerApi = await request.newContext({ baseURL: E2E_BASE_URL, storageState: await mintStorageState(stranger) });
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const base = `/api/leagues/${leagueId}/competitions`;
  try {
    // One completed week — names would show on a public league.
    let res = await ownerApi.post(`${base}/${competitionId}/contests`, {
      data: { competitionId, round: 'Week 1', venueId: venue!.id, holes: 18, playFrom: '2026-08-01', playTo: '2026-08-07' },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const contestId = ((await res.json()).contest as { id: string }).id;
    const { data: parts } = await admin.from('contest_participants').select('id, entry_id').eq('contest_id', contestId);
    const participantOf = new Map((parts ?? []).map(p => [p.entry_id as string, p.id as string]));
    res = await ownerApi.post(`${base}/${competitionId}/results`, {
      data: {
        contestId,
        results: [
          { participantId: participantOf.get(entryOf.get(owner.id)!), score: 78, payload: { gross: 78, holes: 18 } },
          { participantId: participantOf.get(entryOf.get(alpha.id)!), score: 82, payload: { gross: 82, holes: 18 } },
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The site.
    res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const names = ['Edge A.', 'Edge B.', 'Edge Alpha', 'Edge Bravo'];
    const noNames = (html: string, where: string) => {
      for (const n of names) expect(html, `${where} must not name ${n}`).not.toContain(n);
    };
    let home = '';
    await expect
      .poll(async () => { const r = await anon.request.get(`/org/${subdomain}`); home = r.ok() ? await r.text() : ''; return r.status(); }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
      .toBe(200);
    expect(home).toContain(`QA Private League ${stamp}`);
    expect(home).toContain('data-members-only="1"');
    expect(home).toContain(`/join/league/${leagueId}"`);
    expect(home).toContain('Join the league');
    noNames(home, 'home');
    for (const path of ['standings', 'week', `players/qa-anyone-${stamp}`, 'leaders', 'teams', 'gallery', 'divisions']) {
      const r = await anon.request.get(`/org/${subdomain}/${path}`);
      expect(r.status(), path).toBe(200);
      const html = await r.text();
      expect(html, path).toContain('data-members-only="1"');
      noNames(html, path);
    }
    // Public items stay: the schedule page renders (no panel).
    const schedule = await anon.request.get(`/org/${subdomain}/schedule`);
    expect(schedule.status()).toBe(200);
    expect(await schedule.text()).not.toContain('data-members-only');

    // The public standings API and the SSR twin: the empty state.
    const pub = (await (await anon.request.get(`/api/leagues/${leagueId}/standings?_cb=${Date.now()}`)).json()) as { competitions: unknown[] };
    expect(pub.competitions).toEqual([]);
    const twin = await (await anon.request.get(`/league/${leagueId}/standings`)).text();
    expect(twin).toContain('No published standings yet');
    noNames(twin, 'twin');

    // Members read /mine; outsiders don't.
    expect((await anon.request.get(`/api/leagues/${leagueId}/standings/mine`)).status()).toBe(401);
    expect((await strangerApi.get(`/api/leagues/${leagueId}/standings/mine`)).status()).toBe(403);
    res = await alphaApi.get(`/api/leagues/${leagueId}/standings/mine`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect(res.headers()['cache-control']).toContain('private');
    const mine = (await res.json()) as { competitions: { id: string; rows: { entrant_name: string }[] }[] };
    expect(mine.competitions.find(c => c.id === competitionId)?.rows.map(r => r.entrant_name).sort()).toEqual(['Edge A.', 'Edge B.'].sort());

    // The league GET: no member list for outsiders; the list for members.
    const outsiderView = (await (await strangerApi.get(`/api/leagues/${leagueId}`)).json()) as { members: unknown[]; memberCount: number; visibility: string };
    expect(outsiderView.members).toEqual([]);
    expect(outsiderView.memberCount).toBe(2);
    expect(outsiderView.visibility).toBe('private');
    const memberView = (await (await alphaApi.get(`/api/leagues/${leagueId}`)).json()) as { members: unknown[] };
    expect(memberView.members.length).toBeGreaterThan(0);

    // Search marks it private.
    const search = (await (await ownerApi.get(`/api/search?q=${encodeURIComponent(`QA Private League ${stamp}`)}&type=leagues`)).json()) as { results?: { leagues?: { id: string; visibility?: string }[] }; leagues?: { id: string; visibility?: string }[] };
    const found = (search.results?.leagues ?? search.leagues ?? []).find(c => c.id === leagueId);
    expect(found?.visibility).toBe('private');

    // The sitemap keeps the public subpages only.
    const sm = await (await anon.request.get('/sitemap.xml')).text();
    expect(sm).toContain(`${subdomain}/schedule`);
    expect(sm).not.toContain(`${subdomain}/standings`);
    expect(sm).not.toContain(`${subdomain}/teams`);

    // The in-app league page for a member shows the standings (via /mine) at 375px.
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport: { width: 375, height: 812 } });
    try {
      const mp = await memberCtx.newPage();
      await mp.goto(`/league/${leagueId}`);
      await expect(mp.getByText(`Private Ladder ${stamp}`).first()).toBeVisible({ timeout: 20_000 });
      expect(await mp.evaluate(() => document.documentElement.scrollWidth), 'league page: no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await memberCtx.close();
    }
    // The private site home at 375px.
    const page = await anon.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/org/${subdomain}`);
    await expect(page.locator('[data-members-only]').first()).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'private home: no horizontal overflow at 375px').toBeLessThanOrEqual(375);

    // Flip to public → everything visible again (the PATCH revalidates).
    res = await ownerApi.patch(`/api/leagues/${leagueId}`, { data: { visibility: 'public' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await expect
      .poll(async () => (await (await anon.request.get(`/org/${subdomain}/standings`)).text()).includes('data-members-only'), { timeout: 30_000, intervals: [1500, 3000] })
      .toBe(false);
    const openStandings = await (await anon.request.get(`/org/${subdomain}/standings`)).text();
    expect(openStandings).toContain('Edge B.');
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await alphaApi.dispose();
    await strangerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
    await deleteQaUser(stranger.id);
  }
});
