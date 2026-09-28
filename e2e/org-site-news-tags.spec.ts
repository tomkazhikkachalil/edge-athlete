import fs from 'fs';
import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleBody } from './helpers/isr';

// Sports-team website program, N5 (Sep 27 2026, migration 243): a post
// tagged to a TEAM shows on that team's public page, one tagged to a
// DIVISION on the division's page; the card reads the post's summary; a
// cover the post CHOSE leads its page (a derived one stays the body's first
// photo). Skips (green) without 243.

test('news tags: a team post on the team page, a division post on the division page, the summary and the chosen cover @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  for (const b of ['org-site', 'org-site-pages', 'org-site-news-draft'] as const) await resetRateBucket(admin, b, owner.id);
  const probe = await admin.from('org_site_news').select('team_id').limit(1);
  test.skip(probe.error?.code === '42703', 'org_site_news.team_id missing — run migration 243');

  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA News Tags League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { data: team } = await admin.from('teams').insert({ org_id: leagueId, name: `Comets ${stamp}` }).select('id').single();
    const { data: season } = await admin.from('seasons').insert({ org_id: leagueId, label: `Fall ${stamp}` }).select('id').single();
    const { data: division } = await admin.from('divisions').insert({ org_id: leagueId, season_id: season!.id, sport_key: 'ice_hockey', name: `U13 ${stamp}` }).select('id').single();

    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    for (const moduleKey of ['news', 'teams', 'divisions']) {
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey, enabled: true } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    // A cover to choose (a site asset).
    res = await ownerApi.post(`/api/leagues/${leagueId}/site/assets`, { multipart: { image: { name: 'photo.png', mimeType: 'image/png', buffer: fs.readFileSync('e2e/fixtures/photo.png') } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const coverPath = (await res.json()).path as string;

    const makePost = async (title: string, edit: Record<string, unknown>) => {
      let r = await ownerApi.post(`/api/leagues/${leagueId}/site/news`, { data: { title } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      const post = (await r.json()).post as { id: string; slug: string };
      r = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${post.id}`, { data: { edit: { body: [{ type: 'paragraph', text: `Body of ${title}.` }], ...edit } } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      r = await ownerApi.patch(`/api/leagues/${leagueId}/site/news/${post.id}`, { data: { publish: true } });
      expect(r.status(), await readErrorBody(r)).toBe(200);
      return post;
    };
    const teamPost = await makePost(`Comets win ${stamp}`, { teamId: team!.id, summary: `A 4–2 night ${stamp}.`, coverPath });
    await makePost(`U13 schedule out ${stamp}`, { divisionId: division!.id });
    await makePost(`Club AGM ${stamp}`, {});

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    try {
      const siteProbe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = siteProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

      // The team's page: its post (and its summary) — never the division's or the club's.
      const teamHtml = await settleBody(anon.request, `${base}/teams/${team!.id}`, `Comets win ${stamp}`, true, 12);
      expect(teamHtml).toContain('data-team-news');
      expect(teamHtml).toContain(`A 4–2 night ${stamp}.`);
      expect(teamHtml).not.toContain(`U13 schedule out ${stamp}`);
      expect(teamHtml).not.toContain(`Club AGM ${stamp}`);

      // The division's page: its post only.
      const divisionHtml = await settleBody(anon.request, `${base}/divisions/${division!.id}`, `U13 schedule out ${stamp}`, true, 12);
      expect(divisionHtml).toContain('data-division-news');
      expect(divisionHtml).not.toContain(`Comets win ${stamp}`);

      // The post page: the summary leads, the chosen cover sits above the body.
      const page = await anon.newPage();
      await page.goto(`${base}/news/${teamPost.slug}`);
      await expect(page.locator('[data-news-summary]')).toHaveText(`A 4–2 night ${stamp}.`);
      await expect(page.locator('[data-news-cover-hero]')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    const siteIds = ((await admin.from('org_sites').select('id').eq('org_id', leagueId)).data ?? []).map(r => r.id as string);
    if (siteIds.length) await admin.from('org_site_news').delete().in('site_id', siteIds);
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
