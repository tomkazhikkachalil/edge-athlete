import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, G4 (Sep 28 2026): the team and division pages
// go game-day. A league's two teams in one division play a sport-event GAME
// (two named sides, no competition): the division page lists it home-first
// and leads with it as "Next game"; the team page leads with the same game
// (its sides as data, a scoreboard); a practice on the calendar never leads.
// Both at 390px, no sideways scroll. @mobile

test('team + division pages lead with the next game; a division lists its teams’ sport-event games @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Gameday Pages ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  let eventId: string | null = null;
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).in('module_key', ['teams', 'divisions']);
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // A division with two teams, a practice for one, and a game between them.
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `GP ${stamp}` }).select('id').single();
    const { data: division, error: divError } = await admin.from('divisions').insert({ org_id: league.id, season_id: season!.id, name: `U13 A ${stamp}`, sport_key: 'ice_hockey' }).select('id').single();
    expect(divError, divError?.message).toBeNull();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Hawks ${stamp}` }, { org_id: league.id, name: `Storm ${stamp}` }]).select('id, name');
    const hawks = teams!.find(t => (t.name as string).startsWith('Hawks'))!.id as string;
    const storm = teams!.find(t => (t.name as string).startsWith('Storm'))!.id as string;
    await admin.from('team_entries').insert([{ team_id: hawks, division_id: division!.id }, { team_id: storm, division_id: division!.id }]);
    const soon = new Date(Date.now() + 2 * 86_400_000);
    await admin.from('events').insert({ organizer_id: owner.id, title: `Hawks skate ${stamp}`, starts_at: new Date(Date.now() + 86_400_000).toISOString(), ends_at: new Date(Date.now() + 90_000_000).toISOString(), timezone: 'America/Toronto', team_id: hawks, category: 'practice' });
    const { data: ev, error: evError } = await admin
      .from('sport_events')
      .insert({ host_profile_id: owner.id, org_id: league.id, sport_key: 'ice_hockey', shape: 'game', name: `Rivalry night ${stamp}`, visibility: 'public', status: 'open', format_config: { game: { side_names: [`Hawks ${stamp}`, `Storm ${stamp}`] } } })
      .select('id')
      .single();
    expect(evError, evError?.message).toBeNull();
    eventId = ev!.id as string;
    const { error: roundError } = await admin.from('sport_event_rounds').insert({ sport_event_id: eventId, sequence: 1, scheduled_on: soon.toISOString().slice(0, 10), starts_at: soon.toISOString(), course_name: `QA Rink ${stamp}` });
    expect(roundError, roundError?.message).toBeNull();
    await admin.from('sport_event_teams').insert([{ sport_event_id: eventId, side: 1, team_id: hawks }, { sport_event_id: eventId, side: 2, team_id: storm }]);

    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

    // The division page: the game listed home-first and leading as Next game.
    const divHtml = await settleBody(anon.request, `${base}/divisions/${division!.id}`, `Rivalry night ${stamp}`, true, 12);
    expect(divHtml).toContain('data-division-next-game');
    expect(divHtml).toContain(`/events/${eventId}`);
    const page = await anon.newPage();
    await page.goto(`${base}/divisions/${division!.id}`);
    const divNext = page.locator('[data-division-next-game] [data-site-next-game]');
    await expect(divNext).toContainText(`Hawks ${stamp}`);
    await expect(divNext).toContainText(`Storm ${stamp}`);
    await expect(page.getByRole('region', { name: 'Upcoming' })).toContainText(`Hawks ${stamp} vs Storm ${stamp}`);
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px (division)').toBeLessThanOrEqual(390);

    // The team page leads with the same game — never the practice that comes first.
    await settleBody(anon.request, `${base}/teams/${hawks}`, 'data-team-next-game', true, 12);
    await page.goto(`${base}/teams/${hawks}`);
    const teamNext = page.locator('[data-team-next-game] [data-site-next-game]');
    await expect(teamNext).toContainText(`Storm ${stamp}`);
    await expect(teamNext).not.toContainText(`Hawks skate ${stamp}`);
    await expect(teamNext.getByRole('link', { name: 'Game details →' })).toHaveAttribute('href', new RegExp(`/events/${eventId}$`));
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px (team)').toBeLessThanOrEqual(390);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    if (eventId) await admin.from('sport_events').delete().eq('id', eventId);
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
