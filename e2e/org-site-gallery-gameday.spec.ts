import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Sports-team website program, L6 (Sep 28 2026): the game-day designs. The
// gallery offers "Matchday" to a team-sport league; applying it lands the
// pro header on a wide page and MINTS the game-day tiles (seed ids — they
// are not modules): the next game as a banner, the results as a score
// strip. Published, the public home leads with them. @mobile

type Widget = { id: string; key: string; config: Record<string, unknown> };

test('Matchday: the gallery design mints the game-day tiles under the pro header; the public home leads with them @mobile', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const b of ['org-site', 'org-site-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Matchday League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', league.id)), 'org_site_revisions missing — run migration 180');
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_module', moduleKey: 'schedule', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A played game and one to come.
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `MD ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Wolves ${stamp}` }, { org_id: league.id, name: `Bears ${stamp}` }]).select('id, name');
    const wolves = teams!.find(t => (t.name as string).startsWith('Wolves'))!.id as string;
    const bears = teams!.find(t => (t.name as string).startsWith('Bears'))!.id as string;
    const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `Matchday Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
    const { data: entries } = await admin.from('competition_entries').insert([
      { competition_id: comp!.id, team_id: wolves, status: 'approved' },
      { competition_id: comp!.id, team_id: bears, status: 'approved' },
    ]).select('id, team_id');
    const wEntry = entries!.find(e => e.team_id === wolves)!.id;
    const bEntry = entries!.find(e => e.team_id === bears)!.id;
    for (const [days, status, scores] of [[-3, 'completed', [5, 2]], [4, 'scheduled', null]] as const) {
      const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status, scheduled_at: new Date(Date.now() + days * 86_400_000).toISOString() }).select('id').single();
      const { data: parts } = await admin.from('contest_participants').insert([
        { contest_id: contest!.id, entry_id: wEntry, side: 'home' },
        { contest_id: contest!.id, entry_id: bEntry, side: 'away' },
      ]).select('id, entry_id');
      if (scores) {
        await admin.from('contest_results').insert([
          { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === wEntry)!.id, score: scores[0] },
          { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === bEntry)!.id, score: scores[1] },
        ]);
      }
    }

    // The editor's gallery offers Matchday to a team-sport league.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${league.id}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-sb-open-gallery]').click();
      await expect(page.locator('[data-sb-gallery-card="team-matchday"]')).toContainText('Matchday');
      await expect(page.locator('[data-sb-gallery-card="league-central"]')).toContainText('League central');
      await expect(page.locator('[data-sb-gallery-card="club-teams-pro"]')).toHaveCount(0); // a club design
    } finally {
      await ctx.close();
    }

    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'apply_gallery', entryId: 'team-matchday', mode: 'clean' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const canvas = (await (await ownerApi.get(`/api/leagues/${league.id}/site/canvas`)).json()) as { site: { theme_token_set: Record<string, unknown> }; layout: { widgets: Widget[] } };
    expect(canvas.site.theme_token_set).toMatchObject({ header: 'pro', width: 'wide', typeface: 'oswald' });
    const next = canvas.layout.widgets.find(w => w.id === 'seed:next_game');
    const results = canvas.layout.widgets.find(w => w.id === 'seed:results');
    expect(next?.key).toBe('next_game');
    expect(next?.config).toMatchObject({ display: { variant: 'banner' } });
    expect(results?.config).toMatchObject({ display: { variant: 'strip' } });

    await publishSite(ownerApi, 'league', league.id);
    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, base, 'data-widget-id="seed:next_game"', true, 12);
    expect(html).toContain('data-site-header="pro"');
    expect(html).toContain('data-widget-id="seed:results"');
    const page = await anon.newPage();
    await page.goto(base);
    await expect(page.locator('[data-site-next-game][data-variant="banner"]')).toContainText(`Wolves ${stamp}`);
    await expect(page.locator('[data-site-results-widget="strip"]')).toContainText(`Bears ${stamp}`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
