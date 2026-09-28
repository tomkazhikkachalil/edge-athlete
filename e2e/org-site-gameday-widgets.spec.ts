import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';
import { publishSite, revisionsSupported } from './helpers/org-site';

// Sports-team website program, G2 (Sep 28 2026): the game-day sections. A
// "Next game" tile shows the soonest game of the org's public fixture
// competitions as a scoreboard card (or a brand banner); a "Latest results"
// tile shows the finals, home first, as a list or a score strip, linking to
// each contest. Both are web tiles gated by the schedule module; the picker
// offers them; the draft schema refuses a layout option the panel could not
// offer; an empty one never renders publicly.

type Widget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; visibility: string; config: Record<string, unknown> };

test('game-day widgets: next game + latest results on the canvas, the picker and the published page @mobile', async ({ browser }) => {
  test.setTimeout(300_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  for (const b of ['org-site', 'org-site-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Gameday League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
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

    // Two games of a public fixture competition: one played (2–3), one to come.
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `GD ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Blazers ${stamp}` }, { org_id: league.id, name: `Comets ${stamp}` }]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `Gameday Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
    const { data: entries } = await admin.from('competition_entries').insert([
      { competition_id: comp!.id, team_id: comets, status: 'approved' },
      { competition_id: comp!.id, team_id: blazers, status: 'approved' },
    ]).select('id, team_id');
    const cometsEntry = entries!.find(e => e.team_id === comets)!.id;
    const blazersEntry = entries!.find(e => e.team_id === blazers)!.id;
    const game = async (daysFromNow: number, status: 'completed' | 'scheduled', scores?: [number, number]) => {
      const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status, scheduled_at: new Date(Date.now() + daysFromNow * 86_400_000).toISOString(), round: daysFromNow < 0 ? 'Week 1' : 'Week 2' }).select('id').single();
      const { data: parts } = await admin.from('contest_participants').insert([
        { contest_id: contest!.id, entry_id: cometsEntry, side: 'home' },
        { contest_id: contest!.id, entry_id: blazersEntry, side: 'away' },
      ]).select('id, entry_id');
      if (scores) {
        await admin.from('contest_results').insert([
          { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === cometsEntry)!.id, score: scores[0] },
          { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === blazersEntry)!.id, score: scores[1] },
        ]);
      }
      return contest!.id as string;
    };
    const played = await game(-2, 'completed', [2, 3]);
    await game(3, 'scheduled');

    // The two tiles on the draft: a banner next game and a score strip.
    const canvas = (await (await ownerApi.get(`/api/leagues/${league.id}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: Widget[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const widgets: Widget[] = [
      ...canvas.layout.widgets,
      { id: 'w_g2000000000000001', key: 'next_game', x: 0, y: bottom, w: 6, h: 4, cv: 1, visibility: 'public', config: { display: { variant: 'banner' } } },
      { id: 'w_g2000000000000002', key: 'results', x: 6, y: bottom, w: 6, h: 4, cv: 1, visibility: 'public', config: { display: { variant: 'strip', count: 3 } } },
    ];
    res = await ownerApi.put(`/api/leagues/${league.id}/site/draft`, { data: { layout: { ...canvas.layout, widgets } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The generated schema refuses what the panel could not offer.
    res = await ownerApi.put(`/api/leagues/${league.id}/site/draft`, { data: { layout: { ...canvas.layout, widgets: widgets.map(w => (w.key === 'results' ? { ...w, config: { display: { count: 99 } } } : w)) } } });
    expect(res.status()).toBe(400);

    // The editor: the canvas renders both; the picker offers another of each.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${league.id}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-widget="next_game"] [data-site-next-game="upcoming"][data-variant="banner"]')).toContainText(`Comets ${stamp}`);
      await expect(page.locator('[data-sb-widget="results"] [data-site-results-widget="strip"]')).toContainText(`Blazers ${stamp}`);
      await page.getByRole('button', { name: 'Add section', exact: true }).click();
      const picker = page.locator('[data-larger-window="sb-picker"]');
      await expect(picker.locator('[data-sb-picker-tile="next_game"]')).toBeVisible();
      await expect(picker.locator('[data-sb-picker-tile="results"]')).toBeVisible();
    } finally {
      await ctx.close();
    }

    // Published: the public home shows the scoreboard and the strip at 390px.
    await publishSite(ownerApi, 'league', league.id);
    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, base, 'data-site-next-game', true, 12);
    expect(html).toContain(`${base}/schedule/${played}`); // the result links to its contest
    const page = await anon.newPage();
    await page.goto(base);
    const next = page.locator('[data-site-next-game]');
    await expect(next).toContainText(`Comets ${stamp}`);
    await expect(next).toContainText(`Blazers ${stamp}`);
    await expect(next.getByRole('link', { name: 'Full schedule →' })).toHaveAttribute('href', `${base}/schedule`);
    const strip = page.locator('[data-site-results-widget="strip"]');
    await expect(strip).toContainText(`Comets ${stamp}`);
    await expect(strip.getByRole('link', { name: 'All results →' })).toHaveAttribute('href', `${base}/schedule/results`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
