import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// THE SPIKE (phase 2, round 3): standings materialize on result entry and
// reach three public surfaces — the viewer-independent API (with its CDN
// header), the OrgStandings section on the org page, and the SSR
// standings page whose RAW HTML carries the team names (the crawlability
// proof — asserted via request.get, no JS execution).
test('standings: recompute on results; public API + org section + SSR page; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('competition_standings').select('id').limit(1);
  test.skip(!!probe.error, `competition_standings missing — run migration 153 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Standings League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const { data: season } = await admin
    .from('seasons')
    .insert({ league_id: leagueId, label: '2026-27' })
    .select()
    .single();
  const { data: teams } = await admin
    .from('teams')
    .insert([
      { league_id: leagueId, name: `Blazers ${stamp}` },
      { league_id: leagueId, name: `Comets ${stamp}` },
    ])
    .select();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      entrant_type: 'team',
      status: 'active',
      visibility: 'public',
    })
    .select()
    .single();
  const competitionId = comp!.id as string;
  const { data: entries } = await admin
    .from('competition_entries')
    .insert(teams!.map(t => ({ competition_id: competitionId, team_id: t.id })))
    .select();
  const { data: contest } = await admin
    .from('contests')
    .insert({ competition_id: competitionId, scheduled_at: new Date().toISOString() })
    .select()
    .single();
  const { data: participants } = await admin
    .from('contest_participants')
    .insert([
      { contest_id: contest!.id, entry_id: entries![0].id, side: 'home' },
      { contest_id: contest!.id, entry_id: entries![1].id, side: 'away' },
    ])
    .select();

  try {
    // Results via the manager API — the write that triggers the recompute.
    const ownerApi = await apiAs('state-b.json');
    try {
      const res = await ownerApi.post(
        `/api/leagues/${leagueId}/competitions/${competitionId}/results`,
        {
          data: {
            contestId: contest!.id,
            results: [
              { participantId: participants![0].id, score: 3 },
              { participantId: participants![1].id, score: 2 },
            ],
          },
        }
      );
      expect(res.status(), await readErrorBody(res)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }

    // The materialized truth: winner rank 1 with 2 points (hockey default).
    const { data: standings } = await admin
      .from('competition_standings')
      .select('entry_id, rank, points, played, stats')
      .eq('competition_id', competitionId)
      .order('rank');
    expect(standings).toHaveLength(2);
    expect(standings![0]).toMatchObject({ entry_id: entries![0].id, rank: 1, points: 2, played: 1 });
    expect(standings![0].stats).toMatchObject({ w: 1, gf: 3, ga: 2, diff: 1 });
    expect(standings![1]).toMatchObject({ rank: 2, points: 0 });

    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();

      // The viewer-independent API: payload + CDN header, anonymously.
      const apiRes = await page.request.get(`/api/leagues/${leagueId}/standings`);
      expect(apiRes.status()).toBe(200);
      expect(apiRes.headers()['cache-control']).toContain('s-maxage=60');
      const payload = await apiRes.json();
      expect(payload.competitions[0].rows[0].entrant_name).toBe(`Blazers ${stamp}`);

      // THE CRAWLABILITY PROOF: raw HTML of the SSR page carries the
      // names + the metadata title, before any JS runs.
      const htmlRes = await page.request.get(`/league/${leagueId}/standings`);
      expect(htmlRes.status()).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain(`Blazers ${stamp}`);
      expect(html).toContain(`Comets ${stamp}`);
      expect(html).toContain(`${name} Standings`);

      // The org page's additive section renders for the anon viewer.
      await page.goto(`/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { name: 'Standings', exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Full standings →')).toBeVisible();

      // The SSR page in a browser at 375px — usable, no overflow.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/league/${leagueId}/standings`);
      await expect(page.getByText(`Blazers ${stamp}`)).toBeVisible({ timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctxAnon.close();
    }

    // A PRIVATE competition never reaches the public payload.
    await admin.from('competitions').update({ visibility: 'private' }).eq('id', competitionId);
    const ctx2 = await browser.newContext();
    try {
      const page2 = await ctx2.newPage();
      const apiRes2 = await page2.request.get(`/api/leagues/${leagueId}/standings`);
      const payload2 = await apiRes2.json();
      expect(payload2.competitions).toHaveLength(0);
    } finally {
      await ctx2.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
