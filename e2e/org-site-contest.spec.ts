import { test, expect } from '@playwright/test';
import { adminClient, apiAs, readErrorBody, resetRateBucket, loadQaUser } from './helpers/qa-user';
import { settleBody, settleStatus } from './helpers/isr';
import { seedContestLeague } from './helpers/contests';

// Contest Place E4 — the contest's org-site twin. A league with a LIVE site
// and a public fixture contest: /org/{slug}/schedule/{contestId} renders the
// scoreline through ISR (settled), carries a canonical and a SportsEvent
// graph with no Person; the private competition's contest and an unknown
// id are 404s; the per-site sitemap lists the URL once the org is listed;
// the in-app page links to the public one. @mobile: the twin at 390px.

test('org site contest page: public twin renders + 404s + sitemap + in-app link @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const probe = await admin.from('contests').select('id').limit(1);
  test.skip(!!probe.error, `contests missing — run migration 152 (${probe.error?.message})`);

  const seeded = await seedContestLeague();
  const { leagueId, stamp, publicContest, privateContest } = seeded;
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    // Listed, so the sitemap enumerates the site (pre-179 the column is absent and every org reads listed).
    await admin.from('leagues').update({ listing_status: 'listed' }).eq('id', leagueId);
    // The site: create, take live.
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = ((await res.json()).site as { subdomain: string }).subdomain;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // Canonical-aware: with both vanity flags on, /org/{slug} 301s.
    const canonicalProbe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const sitePath = canonicalProbe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;

    // The twin, settled through ISR: scoreline, access marker, canonical, SportsEvent, no Person.
    const url = `${sitePath}/schedule/${publicContest}`;
    const html = await settleBody(anon.request, url, 'Final · 3–2', true, 12);
    expect(html).toContain('data-contest-access="public"');
    expect(html).toContain(`Blazers ${stamp}`);
    expect(html).toContain('rel="canonical" href="');
    expect(html).toContain(`/schedule/${publicContest}`);
    expect(html).toContain('"@type":"SportsEvent"');
    expect(html).not.toContain('"@type":"Person"');
    expect(html).not.toContain(seeded.ownerEmail);
    expect(html).not.toContain('data-contest-live=');

    // The private competition's contest and an unknown id: 404 (indistinguishable).
    expect(await settleStatus(anon.request, `${sitePath}/schedule/${privateContest}`, 404, 6)).toBe(404);
    expect((await anon.request.get(`${sitePath}/schedule/00000000-0000-4000-8000-000000000000`)).status()).toBe(404);
    expect((await anon.request.get(`${sitePath}/schedule/not-a-uuid`)).status()).toBe(404);

    // The per-site sitemap lists the contest (org-sitemap purged by the publish; hourly otherwise).
    const sitemap = await settleBody(anon.request, `/org/${subdomain}/sitemap.xml`, `/schedule/${publicContest}`, true, 12);
    expect(sitemap).toContain(`/schedule/${publicContest}</loc>`);
    expect(sitemap).not.toContain(privateContest);

    // In-app: the owner's page links to the public one; the API carries the path.
    const api = await ownerApi.get(`/api/contests/${publicContest}`);
    expect(api.status(), await readErrorBody(api)).toBe(200);
    expect(((await api.json()) as { publicSitePath: string | null }).publicSitePath).toBe(`${sitePath}/schedule/${publicContest}`);
    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/event/${publicContest}`);
      const link = page.locator('[data-contest-public-site]');
      await expect(link).toBeVisible({ timeout: 20_000 });
      expect(await link.getAttribute('href')).toContain(`/schedule/${publicContest}`);
    } finally {
      await ownerCtx.close();
    }

    // The twin in a browser (phone width on the mobile projects): the score, no overflow.
    const page = await anon.newPage();
    await page.goto(url);
    await expect(page.locator('[data-contest-score="home"]')).toHaveText('3');
    await expect(page.getByRole('link', { name: 'Standings →' })).toBeVisible();
    const width = page.viewportSize()?.width ?? 1280;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'no horizontal overflow on the twin').toBeLessThanOrEqual(width);
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('league_id', leagueId);
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
