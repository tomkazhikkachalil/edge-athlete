import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs, rosterSeasonId } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';
import { openWindow } from './helpers/org-page';

// Teams & divisions program, PR 8 (Sep 27 2026): the in-app team page and
// the org page's Teams tile. The owner taps Teams → the window lists the
// team → its page: roster, schedule, results (a 3–2 win read from the team's
// side), standings, in the team's colours, with "Manage team". A private
// club's outsider gets no tile and a "Team not found" page; teams switched
// off read empty. 390px: no sideways scroll. @mobile

test('team page: the Teams tile → window → team page and its tabs; a private outsider sees nothing @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const player = loadQaUser('user.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Team Page ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const outsiderApi = await apiAs('state-c.json');
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
  try {
    await admin.from('memberships').insert([
      { org_id: club.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' },
      { org_id: club.id, profile_id: player.id, kind: 'follow', role: 'member', status: 'active' },
      { org_id: club.id, profile_id: player.id, kind: 'roster', role: 'member', status: 'active' },
    ]);
    const season = await rosterSeasonId(admin, club.id);
    const { data: teams } = await admin.from('teams').insert([
      { org_id: club.id, name: `Blazers ${stamp}`, primary_color: '#15803d' },
      { org_id: club.id, name: `Comets ${stamp}` },
    ]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    await admin.from('memberships').insert({ org_id: club.id, profile_id: player.id, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: blazers, season_id: season });
    // A private fixture of THIS club, played 3–2 with Blazers away: members see it.
    const { data: comp } = await admin.from('competitions').insert({ org_id: club.id, season_id: season, sport_key: 'ice_hockey', name: `Club Cup ${stamp}`, format: 'fixture', entrant_type: 'team', status: 'active', visibility: 'private' }).select('id').single();
    const { data: entries } = await admin.from('competition_entries').insert([
      { competition_id: comp!.id, team_id: comets, status: 'approved' },
      { competition_id: comp!.id, team_id: blazers, status: 'approved' },
    ]).select('id, team_id');
    const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed', scheduled_at: new Date(Date.now() - 86_400_000).toISOString() }).select('id').single();
    const { data: parts } = await admin.from('contest_participants').insert(entries!.map(e => ({ contest_id: contest!.id, entry_id: e.id, side: e.team_id === comets ? 'home' : 'away' }))).select('id, entry_id');
    await admin.from('contest_results').insert(parts!.map(p => ({ contest_id: contest!.id, participant_id: p.id, score: entries!.find(e => e.id === p.entry_id)!.team_id === comets ? 2 : 3 })));

    // The owner: tile → window → the team page.
    const page = await ctx.newPage();
    await page.goto(`/club/${club.id}`);
    const win = await openWindow(page, 'teams');
    await expect(win.locator(`[data-org-team="${blazers}"]`)).toContainText('1 player');
    await win.locator(`[data-org-team="${blazers}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/club/${club.id}/teams/${blazers}`), { timeout: 20_000 });
    const teamPage = page.locator(`[data-team-page="${blazers}"]`);
    await expect(teamPage).toBeVisible({ timeout: 20_000 });
    await expect(teamPage).toHaveAttribute('data-team-colours', 'team');
    await expect(page.getByRole('link', { name: 'Manage team' })).toBeVisible();

    // The tabs (schedule is the default).
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.locator('[data-team-result="W"]')).toHaveText('W 3–2');
    await page.getByRole('tab', { name: 'Roster' }).click();
    await expect(page.locator('[data-team-tab="roster"]')).not.toContainText('No one on this team yet.');
    await page.getByRole('tab', { name: 'Standings' }).click();
    await expect(page.locator('[data-team-tab="standings"]')).toBeVisible();
    expect(page.url()).toContain('tab=standings');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // A deep link opens its tab.
    await page.goto(`/club/${club.id}/teams/${blazers}?tab=results`);
    await expect(page.locator('[data-team-tab="results"]')).toBeVisible({ timeout: 20_000 });

    // Private club: an outsider gets no teams and no team page.
    await admin.from('organizations').update({ visibility: 'private' }).eq('id', club.id);
    let res = await outsiderApi.get(`/api/clubs/${club.id}/teams`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    expect((await res.json()).teams).toEqual([]);
    expect((await outsiderApi.get(`/api/clubs/${club.id}/teams/${blazers}`)).status()).toBe(404);
    // The owner still sees their private game.
    const mine = await (await ctx.request.get(`/api/clubs/${club.id}/teams/${blazers}`)).json();
    expect(mine.schedule.results[0].result).toEqual({ outcome: 'W', score: '3–2' });

    // Teams switched off: the list reads empty for everyone, the page is not found.
    await admin.from('organizations').update({ operates_teams: false }).eq('id', club.id);
    res = await ctx.request.get(`/api/clubs/${club.id}/teams`);
    expect((await res.json()).teams).toEqual([]);
    expect((await ctx.request.get(`/api/clubs/${club.id}/teams/${blazers}`)).status()).toBe(404);
  } finally {
    await ctx.close();
    await outsiderApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
