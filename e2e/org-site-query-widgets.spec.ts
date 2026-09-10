import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved } from './helpers/isr';

// Site Builder phase 9 — widgets bound to a query. One module key may
// appear N times on a layout, each instance narrowed by its own query: two
// standings tables bound to two competitions (one with rows, one empty), a
// schedule limited to one venue. The empty-widget rule honours the query,
// so the empty table never renders publicly. Skips (green) pre-180.
//
// P9-A drives the DRAFT API; P9-B adds the panel's pickers and drives them.


test('org site: two standings bound to two competitions, a schedule bound to one venue — the query narrows what renders', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Query League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const eventIds: string[] = [];

  try {
    // A season, two teams, two competitions: "Div 1" with a standings row, "Div 2" with none.
    const { data: season } = await admin.from('seasons').insert({ league_id: leagueId, label: `2026 ${stamp}` }).select('id').single();
    const { data: blazers } = await admin.from('teams').insert({ league_id: leagueId, name: `Blazers ${stamp}` }).select('id').single();
    const { data: comets } = await admin.from('teams').insert({ league_id: leagueId, name: `Comets ${stamp}` }).select('id').single();
    const compBase = { league_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' };
    const { data: div1 } = await admin.from('competitions').insert({ ...compBase, name: `Div 1 ${stamp}` }).select('id').single();
    const { data: div2 } = await admin.from('competitions').insert({ ...compBase, name: `Div 2 ${stamp}` }).select('id').single();
    const { data: entries } = await admin
      .from('competition_entries')
      .insert([
        { competition_id: div1!.id, team_id: blazers!.id, status: 'approved' },
        { competition_id: div1!.id, team_id: comets!.id, status: 'approved' },
      ])
      .select('id');
    await admin.from('competition_standings').insert(
      entries!.map((e, i) => ({ competition_id: div1!.id, entry_id: e.id, rank: i + 1, points: 4 - i * 2, played: 2, stats: { w: 2 - i } }))
    );
    // Two venues, one future event at each.
    const { data: arenaA } = await admin.from('venues').insert({ league_id: leagueId, name: `QA Arena A ${stamp}`, city: 'Toronto', region: 'ON' }).select('id').single();
    const { data: arenaB } = await admin.from('venues').insert({ league_id: leagueId, name: `QA Arena B ${stamp}`, city: 'Toronto', region: 'ON' }).select('id').single();
    const starts = new Date(Date.now() + 3 * 86_400_000);
    const { data: seededEvents } = await admin
      .from('events')
      .insert([
        { organizer_id: owner.id, title: `Arena A night ${stamp}`, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 3_600_000).toISOString(), timezone: 'America/Toronto', category: 'social', league_id: leagueId, venue_id: arenaA!.id },
        { organizer_id: owner.id, title: `Arena B night ${stamp}`, starts_at: new Date(starts.getTime() + 86_400_000).toISOString(), ends_at: new Date(starts.getTime() + 90_000_000).toISOString(), timezone: 'America/Toronto', category: 'social', league_id: leagueId, venue_id: arenaB!.id },
      ])
      .select('id');
    for (const e of seededEvents ?? []) eventIds.push(e.id as string);

    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    // Take the site live (the site-level publish); the draft promotes later.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const canvasRes = await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`);
    expect(canvasRes.status(), await readErrorBody(canvasRes)).toBe(200);
    const canvas = (await canvasRes.json()) as {
      layout: { version: 1; cols: 12; widgets: { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: unknown; visibility: string }[] };
    };

    // The layout: the seed's standings tile bound to Div 1, a SECOND standings
    // bound to Div 2 (empty), the schedule bound to Arena A with one row.
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const widgets = canvas.layout.widgets.map(w =>
      w.key === 'standings'
        ? { ...w, config: { title: `Div 1 ${stamp}`, query: { competitionId: div1!.id } } }
        : w.key === 'schedule'
          ? { ...w, config: { title: `At Arena A ${stamp}`, query: { venueId: arenaA!.id, limit: 1 } } }
          : w
    );
    const second = { id: 'w_00000000000009a1', key: 'standings', x: 0, y: bottom, w: 6, h: 4, cv: 1, visibility: 'public', config: { title: `Div 2 ${stamp}`, query: { competitionId: div2!.id } } };

    // A bad query is refused at the draft.
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...widgets, { ...second, config: { query: { limit: 0 } } }] } } });
    expect(res.status()).toBe(400);
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...widgets, { ...second, config: { query: { competitionId: 'nope' } } }] } } });
    expect(res.status()).toBe(400);
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...widgets, second] } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The canvas hands the queries back; the empty table reads as empty to the editor's data too.
    const stored = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; config: { query?: { competitionId?: string } } }[] } };
    expect(stored.layout.widgets.filter(w => w.key === 'standings').map(w => w.config.query?.competitionId).sort()).toEqual([div1!.id, div2!.id].sort());

    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      let html = '';
      await expect
        .poll(async () => {
          html = await (await anon.request.get(`/org/${subdomain}`)).text();
          return html.includes(`Div 1 ${stamp}`);
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      // Div 1: the titled table with a team on it. Div 2: bound to an empty
      // competition → never rendered (one standings tile on the page).
      expect(html).toContain(`Blazers ${stamp}`);
      expect(html.match(/data-widget="standings"/g)?.length ?? 0).toBe(1);
      expect(html).not.toContain(`Div 2 ${stamp}`);
      expect(html).toContain('data-widget-id="legacy:standings"');
      expect(html).not.toContain('data-widget-id="w_00000000000009a1"');
      // The schedule shows Arena A's night only.
      expect(html).toContain(`At Arena A ${stamp}`);
      expect(html).toContain(`Arena A night ${stamp}`);
      expect(html).not.toContain(`Arena B night ${stamp}`);

      // P9-B — the panel binds it. The picker offers a present query widget
      // again ("Add another"); the new tile opens its panel at once; the
      // Competition picker lists the org's competitions; the schedule's Venue
      // picker + How many rebind the existing tile.
      const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
      try {
        const page = await ownerCtx.newPage();
        await page.goto(`/app/org/league/${leagueId}/site/edit`);
        await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
        const before = await page.locator('[data-sb-instance]').count();
        await page.getByRole('button', { name: 'Add section' }).click();
        const tile = page.locator('[data-sb-picker-tile="standings"]');
        await expect(tile.getByRole('button', { name: 'Add another' })).toBeEnabled({ timeout: 20_000 });
        await tile.getByRole('button', { name: 'Add another' }).click();
        await expect(page.locator('[data-sb-instance]')).toHaveCount(before + 1);
        const panel = page.locator('[data-sb-panel="standings"]');
        await expect(panel).toBeVisible();
        const competition = panel.getByLabel('Competition', { exact: true });
        await expect(competition.locator('option')).toHaveCount(3); // Automatic + the two competitions
        await competition.selectOption(div1!.id);
        await panel.getByLabel('Section title').fill(`Div 1 again ${stamp}`);
        await awaitDraftSaved(page);
        // The schedule: rebind to Arena B, one row.
        await page.locator('[data-sb-widget="schedule"] .sb-frame-controls').click();
        const schedulePanel = page.locator('[data-sb-panel="schedule"]');
        await expect(schedulePanel).toBeVisible();
        await schedulePanel.getByLabel('Venue', { exact: true }).selectOption(arenaB!.id);
        await schedulePanel.getByLabel('How many', { exact: true }).fill('1');
        await awaitDraftSaved(page);
        const bound = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as {
          layout: { widgets: { key: string; config: { title?: string; query?: { competitionId?: string; venueId?: string; limit?: number } } }[] };
        };
        expect(bound.layout.widgets.filter(w => w.key === 'standings')).toHaveLength(3);
        expect(bound.layout.widgets.find(w => w.config.title === `Div 1 again ${stamp}`)?.config.query).toEqual({ competitionId: div1!.id });
        expect(bound.layout.widgets.find(w => w.key === 'schedule')?.config.query).toEqual({ venueId: arenaB!.id, limit: 1 });
      } finally {
        await ownerCtx.close();
      }
      await publishSite(ownerApi, 'league', leagueId);
      await expect
        .poll(async () => {
          html = await (await anon.request.get(`/org/${subdomain}`)).text();
          return html.includes(`Div 1 again ${stamp}`) && html.includes(`Arena B night ${stamp}`);
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      // Two Div 1 tables (the second bound through the panel), still no Div 2; Arena B's night, not Arena A's.
      expect(html.match(/data-widget="standings"/g)?.length ?? 0).toBe(2);
      expect(html).not.toContain(`Div 2 ${stamp}`);
      expect(html).not.toContain(`Arena A night ${stamp}`);

      // H3: in-app, three standings instances are ONE standings bubble (the
      // first in reading order names it) — never duplicate cards / keys.
      const appCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
      try {
        const appPage = await appCtx.newPage();
        await appPage.goto(`/league/${leagueId}`);
        await expect(appPage.locator('[data-org-glance]')).toBeVisible({ timeout: 30_000 });
        await expect(appPage.locator('[data-org-bubble="standings"]')).toHaveCount(1);
        await expect(appPage.locator('[data-org-bubble="standings"]')).toContainText(`Div 1 ${stamp}`);
      } finally {
        await appCtx.close();
      }
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    if (eventIds.length > 0) await admin.from('events').delete().in('id', eventIds);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
