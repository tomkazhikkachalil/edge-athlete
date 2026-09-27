import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite } from './helpers/org-site';
import { settleBody, settleStatus } from './helpers/isr';

// Sports-team website program, L4 (Sep 27 2026): the notice band speaks in
// a tone the manager picks in the editor (heads-up amber · information blue ·
// urgent red) with an optional "More" link; and a page that does not exist
// ON a real site renders the site's own 404 inside its header and menu, on
// both route trees — an unknown SITE still gets the platform's 404.

test('notice tone + link from the editor; the site’s own 404 on both trees; an unknown site keeps the platform 404', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Notice League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The manager writes an urgent notice with a link, in the editor.
    const notice = `All fields closed tonight ${stamp}`;
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-sb-widget="hero"] .sb-frame-controls').click();
      const panel = page.locator('[data-sb-panel="hero"]');
      await expect(panel).toBeVisible();
      await panel.getByLabel('Notice', { exact: true }).fill(notice);
      await panel.locator('[data-sb-content="noticeTone"]').selectOption('alert');
      await panel.getByLabel('Notice link', { exact: true }).fill('https://example.com/fields');
      await panel.getByRole('button', { name: 'Save content' }).click();
      await expect.poll(async () => {
        const site = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()).site as { hero_config: Record<string, unknown> };
        return site.hero_config;
      }, { timeout: 15_000 }).toMatchObject({ notice, noticeTone: 'alert', noticeHref: 'https://example.com/fields' });
    } finally {
      await ctx.close();
    }
    await publishSite(ownerApi, 'league', leagueId, 'Urgent notice');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });
    try {
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      await settleBody(anon.request, base, 'data-site-notice="alert"', true, 12);
      const page = await anon.newPage();
      await page.goto(base);
      const band = page.getByRole('status', { name: 'Notice' });
      await expect(band).toContainText('Urgent');
      await expect(band).toContainText(notice);
      await expect(band.getByRole('link', { name: 'More →' })).toHaveAttribute('href', 'https://example.com/fields');

      // A missing page ON the site: the site's own 404, with its header and menu.
      const missing = `${base}/no-such-page-${stamp}`;
      expect(await settleStatus(anon.request, missing, 404)).toBe(404);
      await page.goto(missing);
      await expect(page.locator('[data-site-not-found]')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
      await expect(page.locator('[data-site-menu] > summary')).toBeVisible(); // the way back
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
      // The other route tree answers the same way (or redirects to the canonical one).
      const twin = base.startsWith('/org/') ? `/${subdomain}/no-such-page-${stamp}` : `/org/${subdomain}/no-such-page-${stamp}`;
      const twinRes = await anon.request.get(twin);
      expect(twinRes.status()).toBe(404);
      expect(await twinRes.text()).toContain('data-site-not-found');

      // An unknown SITE keeps the platform's 404 (no site shell to wear).
      const unknown = await anon.request.get(`/org/qa-no-such-site-${stamp}`);
      expect(unknown.status()).toBe(404);
      const unknownBody = await unknown.text();
      expect(unknownBody).toContain('Page not found');
      expect(unknownBody).not.toContain('data-site-not-found');
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
