import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';

// Teams & divisions program, PR 9 (Sep 27 2026): divisions are editable and
// have pages. A published league site with a U13 division, two teams entered
// and a public fixture pinned to it (Comets 2–3 Blazers). The public division
// page lists the teams and the result home-first; the divisions list links
// to it; a foreign division 404s. The in-app page is reached from the team
// page's division line. The owner renames the division (a member is
// refused; a name another division of the season has is a 409). @mobile

test('division page: public and in-app, the result home-first; editable by its manager @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const member = loadQaUser('user.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-structure', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Division League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const other = await createQaOrg(admin, 'league', { name: `QA Other League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const ownerApi = await apiAs('state-b.json');
  const memberApi = await apiAs('state.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json', viewport: { width: 390, height: 844 } });
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    await admin.from('memberships').insert([
      { org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
      { org_id: league.id, profile_id: member.id, kind: 'follow', role: 'member', status: 'active' },
    ]);
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).in('module_key', ['divisions', 'teams']);
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Div ${stamp}` }).select('id').single();
    const { data: divs } = await admin.from('divisions').insert([
      { org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `U13 ${stamp}` },
      { org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name: `U15 ${stamp}` },
    ]).select('id, name');
    const u13 = divs!.find(d => (d.name as string).startsWith('U13'))!.id as string;
    const { data: otherSeason } = await admin.from('seasons').insert({ org_id: other.id, label: `Other ${stamp}` }).select('id').single();
    const { data: foreign } = await admin.from('divisions').insert({ org_id: other.id, season_id: otherSeason!.id, sport_key: 'ice_hockey', name: `Foreign ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Blazers ${stamp}` }, { org_id: league.id, name: `Comets ${stamp}` }]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    await admin.from('team_entries').insert([{ team_id: blazers, division_id: u13 }, { team_id: comets, division_id: u13 }]);
    const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, division_id: u13, sport_key: 'ice_hockey', name: `U13 League ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'public' }).select('id').single();
    const { data: entries } = await admin.from('competition_entries').insert([
      { competition_id: comp!.id, team_id: comets, status: 'approved' },
      { competition_id: comp!.id, team_id: blazers, status: 'approved' },
    ]).select('id, team_id');
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed', scheduled_at: new Date(Date.now() - 86_400_000).toISOString(), round: 'Week 1' }).select('id').single();
    const { data: parts } = await admin.from('contest_participants').insert(entries!.map(e => ({ contest_id: contest!.id, entry_id: e.id, side: e.team_id === comets ? 'home' : 'away' }))).select('id, entry_id');
    await admin.from('contest_results').insert(parts!.map(p => ({ contest_id: contest!.id, participant_id: p.id, score: entries!.find(e => e.id === p.entry_id)!.team_id === comets ? 2 : 3 })));

    // The public page.
    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const list = await settleBody(anon.request, `${base}/divisions`, `U13 ${stamp}`);
    expect(list).toContain(`/divisions/${u13}`);
    const html = await settleBody(anon.request, `${base}/divisions/${u13}`, `Comets ${stamp} 2–3 Blazers ${stamp}`);
    expect(html).toContain(`/teams/${blazers}`);
    await settleStatus(anon.request, `${base}/divisions/${foreign!.id}`, 404);
    const page = await anon.newPage();
    await page.goto(`${base}/divisions/${u13}`);
    await expect(page.locator(`[data-division-page="${u13}"]`)).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // In the app: team page → its division line → the division page → back to a team.
    const app = await ctx.newPage();
    await app.goto(`/league/${league.id}/teams/${blazers}`);
    await app.locator(`[data-team-division="${u13}"]`).click();
    await expect(app).toHaveURL(new RegExp(`/league/${league.id}/divisions/${u13}`), { timeout: 20_000 });
    await expect(app.locator(`[data-division-team="${comets}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(app.getByText(`Comets ${stamp} 2–3 Blazers ${stamp}`)).toBeVisible();
    await expect(app.getByRole('link', { name: 'Edit division' })).toBeVisible();
    expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Editing: a member is refused, a taken name is a 409, the owner renames.
    const url = `/api/leagues/${league.id}/structure/divisions`;
    expect((await memberApi.patch(url, { data: { id: u13, name: 'Nope' } })).status()).toBe(403);
    expect((await ownerApi.patch(url, { data: { id: u13, name: `U15 ${stamp}` } })).status()).toBe(409);
    expect((await ownerApi.patch(url, { data: { id: foreign!.id, name: 'Mine' } })).status()).toBe(404);
    // The console's editor (390px).
    await app.goto(`/app/org/league/${league.id}`);
    await app.getByRole('button', { name: 'Divisions' }).first().click();
    await app.getByRole('button', { name: `Edit U13 ${stamp}` }).click();
    const form = app.locator(`[data-division-edit="${u13}"]`);
    await form.getByLabel('Name', { exact: true }).fill(`U13 Elite ${stamp}`);
    await form.getByLabel('Tier (optional)').fill('AA');
    await form.getByRole('button', { name: 'Save division' }).click();
    await expect(form).toHaveCount(0, { timeout: 20_000 });
    const { data: saved } = await admin.from('divisions').select('name, tier').eq('id', u13).single();
    expect(saved).toEqual({ name: `U13 Elite ${stamp}`, tier: 'AA' });
  } finally {
    await ctx.close();
    await anon.close();
    await ownerApi.dispose();
    await memberApi.dispose();
    await deleteQaOrgs(admin, [league.id, other.id]);
  }
});
