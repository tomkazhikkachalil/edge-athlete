import { test, expect } from '@playwright/test';
import { adminClient, loadQaUser, apiAs } from './helpers/qa-user';

// /event/[contestId] — a contest as a place (Contest Place E1). A public
// competition's contest is server-rendered for a stranger (scoreline in the
// HTML source, the API answers 200 signed-out); a private competition's
// contest is a 404 to a stranger and the same page to a member; a bad id
// is a 404. Seeds a league (owner = QA user B, member = QA user A) with two
// fixture competitions, one public and one private, each with one
// completed contest. Tagged @mobile: the body stacks, the scoreline and
// the way back are reachable at 390px.

const ANON = { cookies: [], origins: [] };

test('contest page: public SSR for a stranger, member-only for a private competition, 404s @mobile', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('contests').select('id').limit(1);
  test.skip(!!probe.error, `contests missing — run migration 152 (${probe.error?.message})`);

  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Place League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
      { league_id: leagueId, profile_id: member.id, role: 'member' },
    ]);
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: '2026-27' }).select().single();
    const { data: teams } = await admin
      .from('teams')
      .insert([{ league_id: leagueId, name: `Blazers ${stamp}` }, { league_id: leagueId, name: `Comets ${stamp}` }])
      .select();
    const [home, away] = teams!;

    const seed = async (visibility: 'public' | 'private', homeScore: number, awayScore: number) => {
      const { data: comp } = await admin
        .from('competitions')
        .insert({
          league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: `${visibility} League`,
          format: 'fixture', entrant_type: 'team', status: 'active', visibility,
        })
        .select()
        .single();
      const { data: entries } = await admin
        .from('competition_entries')
        .insert([{ competition_id: comp!.id, team_id: home.id, status: 'approved' }, { competition_id: comp!.id, team_id: away.id, status: 'approved' }])
        .select();
      const { data: contest } = await admin
        .from('contests')
        .insert({ competition_id: comp!.id, scheduled_at: new Date(stamp - 86_400_000).toISOString(), round: 'Week 1', status: 'completed' })
        .select()
        .single();
      const { data: parts } = await admin
        .from('contest_participants')
        .insert([
          { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === home.id)!.id, side: 'home' },
          { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === away.id)!.id, side: 'away' },
        ])
        .select();
      const { error: resErr } = await admin.from('contest_results').insert([
        { contest_id: contest!.id, participant_id: parts!.find(p => p.side === 'home')!.id, score: homeScore, payload: {}, provenance: 'league_verified', entered_by: owner.id },
        { contest_id: contest!.id, participant_id: parts!.find(p => p.side === 'away')!.id, score: awayScore, payload: {}, provenance: 'league_verified', entered_by: owner.id },
      ]);
      expect(resErr, resErr?.message).toBeNull();
      return contest!.id as string;
    };
    const publicContest = await seed('public', 3, 2);
    const privateContest = await seed('private', 1, 4);

    // A stranger: the API answers the public contest, refuses the private one and a bad id.
    const anon = await request.get(`/api/contests/${publicContest}`, { headers: { cookie: '' } });
    expect(anon.status()).toBe(200);
    const anonBody = await anon.json();
    expect(anonBody.access).toBe('public');
    expect(anonBody.view.outcome.scoreline).toBe('3–2');
    expect(anonBody.view.outcome.home.name).toBe(`Blazers ${stamp}`);
    expect(JSON.stringify(anonBody)).not.toContain(owner.email);
    expect((await request.get(`/api/contests/${privateContest}`, { headers: { cookie: '' } })).status()).toBe(404);
    expect((await request.get('/api/contests/not-a-uuid', { headers: { cookie: '' } })).status()).toBe(404);

    // The stranger's HTML: the scoreline is in the SOURCE (server-rendered).
    const html = await (await request.get(`/event/${publicContest}`, { headers: { cookie: '' } })).text();
    expect(html).toContain('data-contest-access="public"');
    expect(html).toContain(`Blazers ${stamp}`);
    expect(html).toContain('Final · 3–2');

    const anonCtx = await browser.newContext({ storageState: ANON });
    try {
      const page = await anonCtx.newPage();
      await page.goto(`/event/${publicContest}`);
      await expect(page.locator('[data-contest-access="public"]')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toContainText(`Blazers ${stamp} vs Comets ${stamp}`);
      await expect(page.locator('[data-contest-score="home"]')).toHaveText('3');
      await expect(page.getByRole('link', { name: 'Standings →' })).toBeVisible();
      // The private one is a real screen with a way in, never a blank page.
      await page.goto(`/event/${privateContest}`);
      await expect(page.locator('[data-contest-unavailable]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      expect(await page.locator('[data-contest-access]').count()).toBe(0);
    } finally {
      await anonCtx.close();
    }

    // A member: the private contest answers with access 'member', and the page renders it.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.get(`/api/contests/${privateContest}`);
      expect(res.status()).toBe(200);
      expect((await res.json()).access).toBe('member');
    } finally {
      await memberApi.dispose();
    }
    const memberCtx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
    try {
      const page = await memberCtx.newPage();
      await page.goto(`/event/${privateContest}#result`);
      await expect(page.locator('[data-contest-access="member"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-contest-score="away"]')).toHaveText('4');
      await expect(page.locator('#result')).toBeVisible();
      // Never a dead end: the org and standings links exist and fit the viewport.
      const standings = page.getByRole('link', { name: 'Standings →' });
      await expect(standings).toBeVisible();
      const box = await standings.boundingBox();
      const width = page.viewportSize()?.width ?? 1280;
      expect(box && box.x + box.width <= width + 1).toBe(true);
    } finally {
      await memberCtx.close();
    }
  } finally {
    // League delete cascades seasons → competitions → contests → participants → results.
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
