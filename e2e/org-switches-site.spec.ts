import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { settleStatus } from './helpers/isr';

// Teams & divisions program, PR 3 (Sep 26 2026): the switches gate the PUBLIC
// site and the in-app org page. A published club site with Teams and Standings
// on: /teams and /standings serve. The owner turns teams OFF → /teams 404s
// (the module reads disabled for every reader); competitions OFF →
// /standings 404s and the org page loses its Standings tile. On again → both
// serve and the tile is back. Nothing is deleted. @mobile

test('org switches: the public site and the org page follow them; on again brings everything back @mobile', async ({ browser }) => {
  // Eight settles of freshly revalidated ISR pages: a slow instance needs the room (staging, Sep 26 2026 — WebKit passed, Chromium ran out at 240 s).
  test.setTimeout(480_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  const probe = await admin.from('teams').select('sport_key').limit(1);
  test.skip(!!probe.error, `teams.sport_key missing — run migration 242 (${probe.error?.message})`);
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  const stamp = Date.now();
  const club = await createQaOrg(admin, 'club', { name: `QA Switch Site ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: club.id, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/clubs/${club.id}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    // Teams and Standings on (the rows are the published projection).
    await admin.from('org_site_modules').update({ enabled: true }).eq('site_id', siteId).in('module_key', ['teams', 'standings']);
    res = await ownerApi.patch(`/api/clubs/${club.id}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const probeBase = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
    const base = probeBase.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
    await settleStatus(anon.request, `${base}/teams`, 200);
    await settleStatus(anon.request, `${base}/standings`, 200);

    const flip = async (data: Record<string, boolean>) => {
      const r = await ownerApi.patch(`/api/clubs/${club.id}`, { data });
      expect(r.status(), await readErrorBody(r)).toBe(200);
    };

    // Teams off → /teams 404s; standings still serve.
    await flip({ operatesTeams: false });
    await settleStatus(anon.request, `${base}/teams`, 404);
    await settleStatus(anon.request, `${base}/standings`, 200);

    // Competitions off → /standings 404s; the org page has no Standings tile.
    await flip({ operatesCompetitions: false });
    await settleStatus(anon.request, `${base}/standings`, 404);
    const gone = await (await ownerApi.get(`/api/clubs/${club.id}`)).json();
    expect(gone.switches).toEqual({ teams: false, competitions: false });
    const page = await (await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`/club/${club.id}`);
    await expect(page.locator('[data-org-bubble="members"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-org-bubble="standings"]')).toHaveCount(0);

    // On again → everything serves; the module rows were never touched.
    await flip({ operatesTeams: true, operatesCompetitions: true });
    await settleStatus(anon.request, `${base}/teams`, 200);
    await settleStatus(anon.request, `${base}/standings`, 200);
    const { data: rows } = await admin.from('org_site_modules').select('module_key, enabled').eq('site_id', siteId).in('module_key', ['teams', 'standings']);
    expect((rows ?? []).every(r => r.enabled)).toBe(true);
    await page.reload();
    await expect(page.locator('[data-org-bubble="standings"]')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.context().close();
  } finally {
    await anon.close();
    await ownerApi.dispose();
    await deleteQaOrgs(admin, [club.id]);
  }
});
