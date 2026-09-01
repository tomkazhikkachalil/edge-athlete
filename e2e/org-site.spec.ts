import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The public org site shell (phase 3, round 1): create → publish → the
// anonymous /org/{slug} document renders from the (public) segment;
// unpublish → 404 again. The subdomain is minted from the org name
// against the shared reserved denylist; drafts are invisible; a member
// without manage_org gets 403 from the site API.
/** ISR + SWR settle: after revalidateTag the FIRST hit may serve the
 *  stale copy (and ?_cb= never busts a document cache — ISR pages key by
 *  PATHNAME). Poll briefly until the expected status lands. */
async function settle(
  request: { get: (u: string) => Promise<{ status: () => number }> },
  url: string,
  expected: number,
  attempts = 6
): Promise<number> {
  let last = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await request.get(url);
    last = res.status();
    if (last === expected) return last;
    await new Promise(r => setTimeout(r, 2500));
  }
  return last;
}

test('org site: create → publish → anon shell; unpublish → 404; member 403; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('org_sites').select('id').limit(1);
  test.skip(!!probe.error, `org_sites missing — run migration 155 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Site League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);

  try {
    // Owner drives the console: create + publish.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    let subdomain = '';
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Create your site' }).click();
      await expect(page.getByText('draft — publish to go live')).toBeVisible({ timeout: 15_000 });

      const { data: siteRow } = await admin
        .from('org_sites')
        .select('subdomain, published_at')
        .eq('league_id', leagueId)
        .single();
      subdomain = siteRow!.subdomain as string;
      // Minted from the org name; DNS-label shaped.
      expect(subdomain).toMatch(/^qa-site-league-\d+$/);
      expect(siteRow!.published_at).toBeNull();

      // Draft is invisible to the world.
      const anonProbe = await page.request.get(`/org/${subdomain}`);
      expect(anonProbe.status()).toBe(404);

      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('published', { exact: true })).toBeVisible({ timeout: 15_000 });

      // R2: the Sections toggles render, default-on, hero absent.
      await expect(page.getByLabel('Toggle Standings section')).toBeChecked();
      await expect(page.getByLabel('Toggle Contact section')).toBeChecked();
      expect(await page.getByLabel(/^Toggle .* section$/).count()).toBe(8);

      // 375px: the Website card stays usable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText(`/org/${subdomain}`)).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // The anonymous document: org name in the RAW HTML (the ISR shell),
    // module stubs present, metadata title set.
    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();
      // The draft probe cached a 404 for this slug; publish revalidated
      // the tag, and SWR may serve the stale 404 once — settle to 200.
      expect(await settle(page.request, `/org/${subdomain}`, 200)).toBe(200);
      const htmlRes = await page.request.get(`/org/${subdomain}`);
      expect(htmlRes.status()).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain(name);
      expect(html).toContain('Standings');
      expect(html).toContain('Powered by');

      // In a browser at 375px: renders and stays inside the viewport.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/org/${subdomain}`);
      await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

      // The document tree is the (public) segment: no theme script stamp,
      // no app chrome.
      expect(html).not.toContain('data-theme');
      expect(html).not.toContain('Notifications');
    } finally {
      await ctxAnon.close();
    }

    // Member (no manage_org): the site API 403s.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.post(`/api/leagues/${leagueId}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await memberApi.dispose();
    }

    // Unpublish → the world 404s again (revalidateTag makes it immediate).
    const ownerApi = await apiAs('state-b.json');
    try {
      const res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'unpublish' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }
    const ctxAnon2 = await browser.newContext();
    try {
      const page2 = await ctxAnon2.newPage();
      // SWR serves the stale document once post-revalidateTag; settle.
      expect(await settle(page2.request, `/org/${subdomain}`, 404)).toBe(404);
    } finally {
      await ctxAnon2.close();
    }
  } finally {
    // League delete cascades the site (and its modules/pages).
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

// Phase 3 R2: the live-data modules. Seeds a full org (structure,
// public competition + standings, events, venue, affiliation, and a
// roster-imported stub athlete), publishes the site, and asserts the
// RAW HTML of home + every subpage — including THE masking invariant:
// the stub athlete renders "First L." and the full last name never
// reaches a crawlable page. Foreign/garbage teamIds 404.
test('org site modules: live data on home + subpages; masked roster; team 404s', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('org_sites').select('id').limit(1);
  test.skip(!!probe.error, `org_sites missing — run migration 155 (${probe.error?.message})`);
  const probe2 = await admin.from('competition_standings').select('id').limit(1);
  test.skip(!!probe2.error, `competition_standings missing — run migration 153 (${probe2.error?.message})`);

  const stamp = Date.now();
  const name = `QA Modules League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;

  // A second org whose team must 404 under OUR slug (the IDOR line).
  const { data: otherLeague } = await admin
    .from('leagues')
    .insert({ name: `QA Other League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const otherLeagueId = otherLeague!.id as string;

  const eventIds: string[] = [];
  const stubIds: string[] = [];
  let clubId: string | null = null;
  try {
    await admin.from('memberships').insert([
      { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    ]);

    // Structure: season → division → team (+ entry), plus the foreign team.
    const { data: season } = await admin
      .from('seasons')
      .insert({ league_id: leagueId, label: '2026-27' })
      .select()
      .single();
    const { data: division } = await admin
      .from('divisions')
      .insert({ league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: 'U13 A' })
      .select()
      .single();
    const { data: team } = await admin
      .from('teams')
      .insert({ league_id: leagueId, name: `Blazers ${stamp}` })
      .select()
      .single();
    const teamId = team!.id as string;
    await admin.from('team_entries').insert({ team_id: teamId, division_id: division!.id });
    const { data: foreignTeam } = await admin
      .from('teams')
      .insert({ league_id: otherLeagueId, name: `Intruders ${stamp}` })
      .select()
      .single();

    // Public competition with a standings row for the team.
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
    const { data: entry } = await admin
      .from('competition_entries')
      .insert({ competition_id: comp!.id, team_id: teamId, status: 'approved' })
      .select()
      .single();
    await admin.from('competition_standings').insert({
      competition_id: comp!.id,
      entry_id: entry!.id,
      rank: 1,
      points: 2,
      played: 1,
      stats: { w: 1, gf: 4, ga: 1, diff: 3 },
    });

    // Events: one org-scoped, one team-scoped, both future.
    const starts = new Date(Date.now() + 3 * 86_400_000);
    const { data: seededEvents } = await admin
      .from('events')
      .insert([
        {
          organizer_id: owner.id,
          title: `QA Org Night ${stamp}`,
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
          timezone: 'America/Toronto',
          category: 'social',
          league_id: leagueId,
        },
        {
          organizer_id: owner.id,
          title: `QA Team Skate ${stamp}`,
          starts_at: new Date(starts.getTime() + 86_400_000).toISOString(),
          ends_at: new Date(starts.getTime() + 90_000_000).toISOString(),
          timezone: 'America/Toronto',
          category: 'practice',
          team_id: teamId,
        },
      ])
      .select();
    for (const e of seededEvents ?? []) eventIds.push(e.id as string);

    // Venue + facility; an active club affiliation.
    const { data: venue } = await admin
      .from('venues')
      .insert({ league_id: leagueId, name: `QA Arena ${stamp}`, city: 'Toronto', region: 'ON' })
      .select()
      .single();
    await admin.from('facilities').insert({ venue_id: venue!.id, name: 'Rink 1' });
    const { data: club } = await admin
      .from('clubs')
      .insert({ name: `QA Affiliated Club ${stamp}`, owner_profile_id: owner.id })
      .select()
      .single();
    clubId = club!.id as string;
    await admin.from('league_clubs').insert({
      league_id: leagueId,
      club_id: clubId,
      status: 'active',
      initiated_by: 'league',
      affiliation_type: 'member_of',
    });

    // The masking fixture: roster-import mints a stub profile (private,
    // @stubs.invalid) with a TEAM roster row — the sanctioned recipe.
    const ownerApi = await apiAs('state-b.json');
    let subdomain = '';
    try {
      const imported = await ownerApi.post(`/api/leagues/${leagueId}/roster-import`, {
        data: { teamId, text: 'Casey Zimmermantest' },
      });
      expect(imported.status(), await readErrorBody(imported)).toBe(200);

      // Site: create + publish via the API (the console drive is test 1).
      const created = await ownerApi.post(`/api/leagues/${leagueId}/site`);
      expect(created.status(), await readErrorBody(created)).toBe(200);
      const published = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'publish' },
      });
      expect(published.status(), await readErrorBody(published)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }
    const { data: stubRows } = await admin
      .from('profiles')
      .select('id')
      .like('email', '%@stubs.invalid')
      .eq('last_name', 'Zimmermantest');
    for (const s of stubRows ?? []) stubIds.push(s.id as string);
    const { data: siteRow } = await admin
      .from('org_sites')
      .select('subdomain')
      .eq('league_id', leagueId)
      .single();
    subdomain = siteRow!.subdomain as string;

    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();
      const base = `/org/${subdomain}`;
      expect(await settle(page.request, base, 200)).toBe(200);

      // HOME: every module carries live data in the raw HTML.
      const home = await (await page.request.get(base)).text();
      expect(home).toContain(`Blazers ${stamp}`); // teams chip + standings row
      expect(home).toContain('House League'); // standings preview header
      expect(home).toContain(`QA Org Night ${stamp}`); // schedule
      expect(home).toContain(`QA Arena ${stamp}`); // venues
      expect(home).toContain('Rink 1'); // facility
      expect(home).toContain(`QA Affiliated Club ${stamp}`); // affiliations
      expect(home).toContain('Coming soon.'); // sponsors/contact stubs stay
      expect(home).toContain('Full standings →');
      expect(home).toContain('Full schedule →');

      // SUBPAGES: settle each path (the pre-publish 404 caches per path).
      expect(await settle(page.request, `${base}/standings`, 200)).toBe(200);
      const standings = await (await page.request.get(`${base}/standings`)).text();
      expect(standings).toContain('House League');
      expect(standings).toContain(`Blazers ${stamp}`);
      expect(standings).toContain(`${name} Standings`); // metadata title

      expect(await settle(page.request, `${base}/schedule`, 200)).toBe(200);
      const schedule = await (await page.request.get(`${base}/schedule`)).text();
      expect(schedule).toContain(`QA Org Night ${stamp}`);
      expect(schedule).toContain(`QA Team Skate ${stamp}`); // team event unions in

      expect(await settle(page.request, `${base}/teams`, 200)).toBe(200);
      const teams = await (await page.request.get(`${base}/teams`)).text();
      expect(teams).toContain(`Blazers ${stamp}`);
      expect(teams).toContain('U13 A'); // division label

      // TEAM PAGE: record + schedule + MASKED roster.
      expect(await settle(page.request, `${base}/teams/${teamId}`, 200)).toBe(200);
      const teamHtml = await (await page.request.get(`${base}/teams/${teamId}`)).text();
      expect(teamHtml).toContain(`Blazers ${stamp}`);
      expect(teamHtml).toContain('House League'); // record row
      expect(teamHtml).toContain(`QA Team Skate ${stamp}`); // upcoming
      expect(teamHtml).toContain('Casey Z.'); // THE MASK
      expect(teamHtml).not.toContain('Zimmermantest'); // full name never ships
      expect(teamHtml).not.toContain('@stubs.invalid'); // no emails, ever

      // A foreign org's team under OUR slug → 404; garbage → 404.
      expect(
        (await page.request.get(`${base}/teams/${foreignTeam!.id}`)).status()
      ).toBe(404);
      expect(
        (await page.request.get(`${base}/teams/not-a-uuid`)).status()
      ).toBe(404);

      // 375px: standings subpage and team page stay inside the viewport.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${base}/standings`);
      await expect(page.getByText(`Blazers ${stamp}`).first()).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'standings: no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);
      await page.goto(`${base}/teams/${teamId}`);
      await expect(page.getByText('Casey Z.')).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'team page: no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);

      // R2 toggles: disable standings → home drops the section and the
      // subpage 404s; re-enable → both come back. Hero can't be toggled.
      const toggleApi = await apiAs('state-b.json');
      try {
        const off = await toggleApi.patch(`/api/leagues/${leagueId}/site`, {
          data: { action: 'set_module', moduleKey: 'standings', enabled: false },
        });
        expect(off.status(), await readErrorBody(off)).toBe(200);
        expect(await settle(page.request, `${base}/standings`, 404)).toBe(404);
        // Content settle: SWR may serve the stale home document once.
        let homeAfter = '';
        for (let i = 0; i < 6; i++) {
          homeAfter = await (await page.request.get(base)).text();
          if (!homeAfter.includes('Full standings →')) break;
          await new Promise(r => setTimeout(r, 2500));
        }
        expect(homeAfter).not.toContain('Full standings →');
        expect(homeAfter).toContain(`QA Org Night ${stamp}`); // others intact

        const on = await toggleApi.patch(`/api/leagues/${leagueId}/site`, {
          data: { action: 'set_module', moduleKey: 'standings', enabled: true },
        });
        expect(on.status(), await readErrorBody(on)).toBe(200);
        expect(await settle(page.request, `${base}/standings`, 200)).toBe(200);

        const hero = await toggleApi.patch(`/api/leagues/${leagueId}/site`, {
          data: { action: 'set_module', moduleKey: 'hero', enabled: false },
        });
        expect(hero.status(), await readErrorBody(hero)).toBe(400);
      } finally {
        await toggleApi.dispose();
      }
    } finally {
      await ctxAnon.close();
    }
  } finally {
    // Events SET NULL on league delete — remove them explicitly; league
    // delete cascades site/structure/memberships; stubs go by hand.
    for (const id of eventIds) {
      await admin.from('event_guests').delete().eq('event_id', id);
      await admin.from('events').delete().eq('id', id);
    }
    await admin.from('leagues').delete().eq('id', leagueId);
    await admin.from('leagues').delete().eq('id', otherLeagueId);
    if (clubId) await admin.from('clubs').delete().eq('id', clubId);
    for (const id of stubIds) {
      await admin.from('profiles').delete().eq('id', id);
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
  }
});

// Phase 3 R3: branding. The console's hero/theme/sponsors writes reach the
// anonymous document — headline/tagline replace the defaults, the accent
// hex lands in the injected style (and only a validated hex ever can),
// sponsors render as nofollow links, and a light accent is refused.
test('org site branding: hero, theme accent, sponsors', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('org_sites').select('id').limit(1);
  test.skip(!!probe.error, `org_sites missing — run migration 155 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Brand League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;

  try {
    await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);

    const ownerApi = await apiAs('state-b.json');
    try {
      const created = await ownerApi.post(`/api/leagues/${leagueId}/site`);
      expect(created.status(), await readErrorBody(created)).toBe(200);
      const published = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'publish' },
      });
      expect(published.status(), await readErrorBody(published)).toBe(200);

      // A near-white accent is refused at the schema (white hero text).
      const tooLight = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_theme', accent: '#ffff00' },
      });
      expect(tooLight.status()).toBe(400);

      const hero = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: {
          action: 'set_hero',
          headline: `Play with us ${stamp}`,
          tagline: 'Hockey for everyone.',
        },
      });
      expect(hero.status(), await readErrorBody(hero)).toBe(200);
      const theme = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_theme', accent: '#0F766E' },
      });
      expect(theme.status(), await readErrorBody(theme)).toBe(200);
      const sponsors = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: {
          action: 'set_sponsors',
          sponsors: [{ name: `Rinkside Supply ${stamp}`, url: 'https://example.com/rinkside' }],
        },
      });
      expect(sponsors.status(), await readErrorBody(sponsors)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }

    const { data: siteRow } = await admin
      .from('org_sites')
      .select('subdomain')
      .eq('league_id', leagueId)
      .single();
    const base = `/org/${siteRow!.subdomain}`;

    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();
      expect(await settle(page.request, base, 200)).toBe(200);
      // Content settle: SWR may serve the pre-branding document once.
      let html = '';
      for (let i = 0; i < 6; i++) {
        html = await (await page.request.get(base)).text();
        if (html.includes(`Play with us ${stamp}`)) break;
        await new Promise(r => setTimeout(r, 2500));
      }
      expect(html).toContain(`Play with us ${stamp}`);
      expect(html).toContain('Hockey for everyone.');
      expect(html).toContain('--org-accent:#0f766e');
      expect(html).toContain(`Rinkside Supply ${stamp}`);
      expect(html).toContain('rel="noopener nofollow"');

      // Reset the theme → the injected style disappears (violet defaults).
      const ownerApi2 = await apiAs('state-b.json');
      try {
        const reset = await ownerApi2.patch(`/api/leagues/${leagueId}/site`, {
          data: { action: 'set_theme', accent: null },
        });
        expect(reset.status(), await readErrorBody(reset)).toBe(200);
      } finally {
        await ownerApi2.dispose();
      }
      let htmlAfter = '';
      for (let i = 0; i < 6; i++) {
        htmlAfter = await (await page.request.get(base)).text();
        if (!htmlAfter.includes('--org-accent:#0f766e')) break;
        await new Promise(r => setTimeout(r, 2500));
      }
      expect(htmlAfter).not.toContain('--org-accent:#0f766e');
      expect(htmlAfter).toContain(`Play with us ${stamp}`); // hero survives

      // 375px: the branded home stays inside the viewport.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(base);
      await expect(page.getByText(`Play with us ${stamp}`)).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        'no horizontal overflow at 375px'
      ).toBeLessThanOrEqual(375);
    } finally {
      await ctxAnon.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
