import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';

// Two pages (phase 6c G3 — Tom's principle 1): a CLUB site and a LEAGUE
// site answer different questions, so their default section order
// differs (club: courses then leagues; league: standings then schedule),
// the affiliations section reads "Leagues" on a club and "Clubs" on a
// league, a scrambled order resets to the recommended one, and a club
// page shows "this week at the club" — the golf boards of the leagues
// affiliated with it — masked like every public board. Zero DDL.

async function settleBody(
  request: { get: (u: string) => Promise<{ text: () => Promise<string> }> },
  url: string,
  needle: string,
  shouldContain = true,
  attempts = 10
): Promise<string> {
  let body = '';
  for (let i = 0; i < attempts; i++) {
    body = await (await request.get(url)).text();
    if (body.includes(needle) === shouldContain) return body;
    await new Promise(r => setTimeout(r, 2500));
  }
  return body;
}

test('two pages: side default orders, side labels, reset, and the club golf teaser; 375px both', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const alpha = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);

  const stamp = Date.now();
  const clubName = `QA Two Pages Club ${stamp}`;
  const leagueName = `QA Two Pages League ${stamp}`;
  const { data: club } = await admin.from('clubs').insert({ name: clubName, owner_profile_id: owner.id }).select().single();
  const clubId = club!.id as string;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name: leagueName, sport_key: 'golf', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { club_id: clubId, league_id: null, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: null, league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'follow' },
    { club_id: null, league_id: leagueId, profile_id: owner.id, role: 'owner', kind: 'roster' },
    { club_id: null, league_id: leagueId, profile_id: alpha.id, role: 'member', kind: 'roster' },
  ]);
  // The league is affiliated with (plays at) the club.
  await admin.from('league_clubs').insert({ league_id: leagueId, club_id: clubId, status: 'active', initiated_by: 'league' });
  // A public golf leaderboard on the league with a materialized board.
  const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: `2026 ${stamp}` }).select().single();
  const { data: comp } = await admin
    .from('competitions')
    .insert({
      league_id: leagueId,
      season_id: season!.id,
      sport_key: 'golf',
      name: `Thursday Nine ${stamp}`,
      format: 'leaderboard',
      entrant_type: 'athlete',
      scoring_rule: 'golf_gross',
      status: 'active',
      visibility: 'public',
    })
    .select('id')
    .single();
  const { data: entries } = await admin
    .from('competition_entries')
    .insert([
      { competition_id: comp!.id, profile_id: owner.id, status: 'approved' },
      { competition_id: comp!.id, profile_id: alpha.id, status: 'approved' },
    ])
    .select('id, profile_id');
  await admin.from('competition_standings').insert(
    entries!.map((e, i) => ({
      competition_id: comp!.id,
      entry_id: e.id,
      rank: i + 1,
      points: 38 + i,
      played: 1,
      stats: { gross: 38 + i },
    }))
  );

  const ownerApi = await apiAs('state-b.json');
  const sites: Partial<Record<'club' | 'league', { id: string; subdomain: string }>> = {};
  try {
    // Create + publish both sites.
    for (const [side, id] of [['club', clubId], ['league', leagueId]] as const) {
      let res = await ownerApi.post(`/api/${side}s/${id}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(200);
      sites[side] = (await res.json()).site as { id: string; subdomain: string };
      res = await ownerApi.patch(`/api/${side}s/${id}/site`, { data: { action: 'publish' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    // Seeded order differs by side.
    const orderOf = async (siteId: string) => {
      const { data } = await admin
        .from('org_site_modules')
        .select('module_key, sort_order')
        .eq('site_id', siteId)
        .order('sort_order');
      return (data ?? []).map(r => r.module_key as string);
    };
    const clubOrder = await orderOf(sites.club!.id);
    const leagueOrder = await orderOf(sites.league!.id);
    expect(clubOrder.slice(0, 3)).toEqual(['hero', 'courses', 'affiliations']);
    // C3: a GOLF league takes the golf shape (standings, then leaders); a club
    // without a sport keeps the classic order.
    expect(leagueOrder.slice(0, 3)).toEqual(['hero', 'standings', 'leaders']);

    // Scramble the club, then reset → back to the recommended order.
    let res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
      data: { action: 'set_nav', items: [{ key: 'standings', label: 'Tables' }, { key: 'courses' }] },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const scrambled = await orderOf(sites.club!.id);
    expect(scrambled.indexOf('standings')).toBeLessThan(scrambled.indexOf('courses'));
    res = await ownerApi.patch(`/api/clubs/${clubId}/site`, { data: { action: 'reset_order' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await orderOf(sites.club!.id)).slice(0, 3)).toEqual(['hero', 'courses', 'affiliations']);
    const { data: siteRow } = await admin.from('org_sites').select('nav_config').eq('id', sites.club!.id).single();
    // Labels survive a reset; the order does not.
    expect(siteRow!.nav_config).toEqual([{ key: 'standings', label: 'Tables' }]);

    const anonCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pathFor = async (subdomain: string) => {
        const probe = await anonCtx.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
        return probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      };
      const clubPath = await pathFor(sites.club!.subdomain);
      const leaguePath = await pathFor(sites.league!.subdomain);

      // Club page: "Leagues" labels the affiliations section; the golf
      // teaser names the league's board with a MASKED entrant.
      const clubHtml = await settleBody(anonCtx.request, clubPath, `Thursday Nine ${stamp}`);
      expect(clubHtml).toContain('aria-label="Leagues"');
      // React SSR splits adjacent text nodes with <!-- --> — assert the parts.
      expect(clubHtml).toContain('This week at ');
      expect(clubHtml).toContain(`aria-label="Thursday Nine ${stamp}"`);
      expect(clubHtml).toContain('>Player<');
      // QA profiles are claimed + public → full first name shows; a minor
      // never would (G1's omission rule rides fetchPublicStandings).
      expect(clubHtml).toMatch(/Edge (Alpha|Bravo|A\.|B\.)/);
      // Order on the page: Courses section before Standings (the reset).
      expect(clubHtml.indexOf('aria-label="Courses"')).toBeLessThan(clubHtml.indexOf('aria-label="Tables"'));

      // League page: "Clubs", standings first, no teaser.
      const leagueHtml = await settleBody(anonCtx.request, leaguePath, 'aria-label="Clubs"');
      expect(leagueHtml).toContain('aria-label="Clubs"');
      expect(leagueHtml.indexOf('aria-label="Season standings"')).toBeLessThan(leagueHtml.indexOf('aria-label="Clubs"'));
      expect(leagueHtml).not.toContain('This week at');

      // 375px on both.
      const page = await anonCtx.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      for (const [path, name] of [[clubPath, clubName], [leaguePath, leagueName]] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} no overflow at 375px`).toBeLessThanOrEqual(375);
      }
    } finally {
      await anonCtx.close();
    }

    // Console: the reset button exists next to Save layout.
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/club/${clubId}`);
      await expect(page.getByRole('button', { name: 'Reset to recommended order' })).toBeVisible({ timeout: 20_000 });
    } finally {
      await ownerCtx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().in('id', [sites.club?.id, sites.league?.id].filter(Boolean) as string[]);
    await admin.from('competitions').delete().eq('league_id', leagueId);
    await admin.from('league_clubs').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('clubs').delete().eq('id', clubId);
  }
});
