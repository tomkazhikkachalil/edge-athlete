import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Sports-team website program, G3 (Sep 28 2026): a game-day tile can follow
// ONE team. A club that runs teams but no competitions (the "either" switch)
// shows its team's games in a LEAGUE's public competition — linked to the
// app's public contest place, since the club's own site cannot show another
// org's contest. A tile bound to a team with no games never renders
// publicly. The panel offers the org's teams.

type Widget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; visibility: string; config: Record<string, unknown> };

test('game-day team query: a club team’s league games on the club site; a team with none shows nothing @mobile', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const b of ['org-site', 'org-site-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Gameday Club ${stamp}`, operates_competitions: false, owner_profile_id: owner.id });
  const league = await createQaOrg(admin, 'league', { name: `QA Gameday Host ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  try {
    let res = await ownerApi.post(`/api/clubs/${club.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/clubs/${club.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'club', club.id)), 'org_site_revisions missing — run migration 180');
    res = await ownerApi.patch(`/api/clubs/${club.id}/site`, { data: { action: 'set_module', moduleKey: 'schedule', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The club's two teams; the U13s play the league's public cup, the U11s nothing.
    const { data: clubTeams } = await admin.from('teams').insert([{ org_id: club.id, name: `U13 Hawks ${stamp}` }, { org_id: club.id, name: `U11 Hawks ${stamp}` }]).select('id, name');
    const u13 = clubTeams!.find(t => (t.name as string).startsWith('U13'))!.id as string;
    const u11 = clubTeams!.find(t => (t.name as string).startsWith('U11'))!.id as string;
    const { data: rival } = await admin.from('teams').insert({ org_id: league.id, name: `Storm ${stamp}` }).select('id').single();
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `GT ${stamp}` }).select('id').single();
    const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `Host Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
    const { data: entries } = await admin.from('competition_entries').insert([
      { competition_id: comp!.id, team_id: u13, status: 'approved' },
      { competition_id: comp!.id, team_id: rival!.id, status: 'approved' },
    ]).select('id, team_id');
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'scheduled', scheduled_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), round: 'Week 3' }).select('id').single();
    await admin.from('contest_participants').insert([
      { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === rival!.id)!.id, side: 'home' },
      { contest_id: contest!.id, entry_id: entries!.find(e => e.team_id === u13)!.id, side: 'away' },
    ]);

    // Two next-game tiles: one bound to the U13s, one to the U11s.
    const canvas = (await (await ownerApi.get(`/api/clubs/${club.id}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: Widget[] }; options: { teams: { id: string; name: string }[] } };
    expect(canvas.options.teams.map(t => t.id)).toEqual(expect.arrayContaining([u13, u11]));
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const widgets: Widget[] = [
      ...canvas.layout.widgets,
      { id: 'w_g3000000000000001', key: 'next_game', x: 0, y: bottom, w: 6, h: 4, cv: 1, visibility: 'public', config: { title: `U13 next ${stamp}`, query: { teamId: u13 } } },
      { id: 'w_g3000000000000002', key: 'next_game', x: 6, y: bottom, w: 6, h: 4, cv: 1, visibility: 'public', config: { title: `U11 next ${stamp}`, query: { teamId: u11 } } },
    ];
    res = await ownerApi.put(`/api/clubs/${club.id}/site/draft`, { data: { layout: { ...canvas.layout, widgets } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The panel offers the team picker on a next-game tile.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/club/${club.id}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.locator(`[data-sb-instance="w_g3000000000000001"] .sb-frame-controls`).click();
      await expect(page.locator('select[data-sb-query="teamId"]')).toHaveValue(u13);
    } finally {
      await ctx.close();
    }

    await publishSite(ownerApi, 'club', club.id);
    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, base, `U13 next ${stamp}`, true, 12);
    expect(html).toContain(`/event/${contest!.id}`); // another org's contest: the app's public place
    expect(html).not.toContain(`U11 next ${stamp}`); // a team with no games: no tile
    const page = await anon.newPage();
    await page.goto(base);
    const card = page.locator('[data-site-next-game]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`U13 Hawks ${stamp}`);
    await expect(card).toContainText(`Storm ${stamp}`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', club.id);
    await deleteQaOrgs(admin, [club.id, league.id]);
  }
});
