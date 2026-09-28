import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, G1 (Sep 28 2026): the site's Results page —
// every final game of the org's PUBLIC fixture competitions, home first
// ("Comets 2–3 Blazers"), linking to its contest page; the schedule page links
// to it (Upcoming | Results — static pages, no ?tab=); the site's sitemap lists
// it; a private competition's game never shows; a private club's results are
// the members-only panel (its team names are members-only).

test('results page: finals home-first with contest links, the Upcoming | Results tabs, the sitemap; private stays off @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Results League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, kind: 'follow', role: 'owner', status: 'active' }]);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
  try {
    let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain } = (await res.json()).site as { subdomain: string };
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const { data: season } = await admin.from('seasons').insert({ org_id: league.id, label: `Res ${stamp}` }).select('id').single();
    const { data: teams } = await admin.from('teams').insert([{ org_id: league.id, name: `Blazers ${stamp}` }, { org_id: league.id, name: `Comets ${stamp}` }]).select('id, name');
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
      return contest!.id as string;
    };
    const openGame = await fixture(`Open Cup ${stamp}`, 'public', [2, 3]);
    await fixture(`Secret Cup ${stamp}`, 'private', [9, 0]);

    const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    const html = await settleBody(anon.request, `${base}/schedule/results`, `Comets ${stamp} 2–3 Blazers ${stamp}`, true, 12);
    expect(html).toContain('data-site-results');
    expect(html).toContain(`${base}/schedule/${openGame}`);
    expect(html).not.toContain(`Comets ${stamp} 9–0 Blazers ${stamp}`); // the private competition's game

    // The tabs: the schedule page links to Results; Results links back.
    const page = await anon.newPage();
    await page.goto(`${base}/schedule`);
    await page.locator('[data-site-results-link]').click();
    await expect(page).toHaveURL(new RegExp(`${base}/schedule/results$`));
    await expect(page.getByRole('heading', { name: 'Results', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upcoming' })).toHaveAttribute('href', `${base}/schedule`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);

    // The site's sitemap lists it.
    const sitemap = await settleBody(anon.request, `${base}/sitemap.xml`, '/schedule/results', true, 12);
    expect(sitemap).toContain('/schedule/results</loc>');

    // A private club: its results are members-only.
    res = await ownerApi.patch(`/api/leagues/${league.id}`, { data: { visibility: 'private' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const privateHtml = await settleBody(anon.request, `${base}/schedule/results`, 'data-members-only', true, 12);
    expect(privateHtml).not.toContain(`Blazers ${stamp}`);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', league.id);
    await deleteQaOrgs(admin, [league.id]);
  }
});
