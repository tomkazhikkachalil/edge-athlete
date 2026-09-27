import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Teams & divisions program, PR 7 (Sep 27 2026): the PUBLIC team page shows
// the team's whole schedule. A published league site; Blazers (with its own
// colours) played Comets in a PUBLIC fixture — Blazers away, 3–2 — and has a
// team practice next week. The page lists the practice under Upcoming and
// "W 3–2 · vs Comets" under Results (the score from the TEAM's side), wears
// the team's colours, and never shows a PRIVATE competition's game. 390px:
// no sideways scroll. @mobile

test('public team page: whole schedule, results from the team side, team colours; a private competition stays off @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('sport_event_teams').select('side').limit(1);
  test.skip(!!probe.error, `sport_event_teams missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Schedule League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json', viewport: { width: 390, height: 844 } });
  try {
    // The site, live, with Teams on.
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).eq('module_key', 'teams');
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // Structure: two teams (Blazers with colours), a public fixture played 3–2 away, a private one, a practice.
    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Sched ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([
      { org_id: league.id, name: `Blazers ${stamp}`, primary_color: '#dc2626', secondary_color: '#7f1d1d' },
      { org_id: league.id, name: `Comets ${stamp}` },
    ]).select('id, name');
    const blazers = teams!.find(t => (t.name as string).startsWith('Blazers'))!.id as string;
    const comets = teams!.find(t => (t.name as string).startsWith('Comets'))!.id as string;
    const fixture = async (name: string, visibility: 'public' | 'private', scores: [number, number]) => {
      const { data: comp } = await admin.from('competitions').insert({ org_id: league.id, season_id: season!.id, sport_key: 'ice_hockey', name, format: 'fixture', entrant_type: 'team', status: 'active', visibility }).select('id').single();
      const { data: entries } = await admin.from('competition_entries').insert([
        { competition_id: comp!.id, team_id: comets, status: 'approved' },
        { competition_id: comp!.id, team_id: blazers, status: 'approved' },
      ]).select('id, team_id');
      const cometsEntry = entries!.find(e => e.team_id === comets)!.id;
      const blazersEntry = entries!.find(e => e.team_id === blazers)!.id;
      const { data: contest } = await admin.from('contests').insert({ competition_id: comp!.id, status: 'completed', scheduled_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), round: 'Week 1' }).select('id').single();
      const { data: parts } = await admin.from('contest_participants').insert([
        { contest_id: contest!.id, entry_id: cometsEntry, side: 'home' },
        { contest_id: contest!.id, entry_id: blazersEntry, side: 'away' },
      ]).select('id, entry_id');
      await admin.from('contest_results').insert([
        { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === cometsEntry)!.id, score: scores[0] },
        { contest_id: contest!.id, participant_id: parts!.find(p => p.entry_id === blazersEntry)!.id, score: scores[1] },
      ]);
    };
    await fixture(`Open Cup ${stamp}`, 'public', [2, 3]);
    await fixture(`Secret Cup ${stamp}`, 'private', [9, 0]);
    const practiceAt = new Date(Date.now() + 5 * 86_400_000);
    await admin.from('events').insert({ organizer_id: owner.id, title: `Blazers skate ${stamp}`, starts_at: practiceAt.toISOString(), ends_at: new Date(practiceAt.getTime() + 3_600_000).toISOString(), timezone: 'America/Toronto', team_id: blazers, category: 'practice' });

    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, `${base}/teams/${blazers}`, `Open Cup ${stamp}`);
    expect(html).toContain(`Blazers skate ${stamp}`); // Upcoming: the practice
    expect(html).toContain('W 3–2'); // Results: from Blazers' side (they were away)
    expect(html).toContain(`vs Comets ${stamp}`);
    expect(html).not.toContain(`Secret Cup ${stamp}`); // a private competition stays off the public page
    expect(html).toContain('data-team-colours="team"');
    expect(html).toContain('--org-accent:#dc2626');

    // The opponent's page reads the same game from ITS side.
    const cometsHtml = await settleBody(anon.request, `${base}/teams/${comets}`, `Open Cup ${stamp}`);
    expect(cometsHtml).toContain('L 2–3');
    expect(cometsHtml).toContain('data-team-colours="site"');

    // 390px: the page stays inside the viewport.
    const page = await anon.newPage();
    await page.goto(`${base}/teams/${blazers}`);
    await expect(page.locator('[data-team-result="W"]')).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await deleteQaOrgs(admin, [league.id]);
  }
});
