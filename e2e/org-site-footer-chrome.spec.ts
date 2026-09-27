import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Sports-team website program, L3 (Sep 27 2026): the footer chrome — the
// socials as icons (inline SVG; the name for screen readers), and a sponsor
// bar the manager places from the editor's Settings (off · above the footer ·
// under the header): the Sponsors section's list, top tier first, on every page.

test('footer chrome: sponsor bar placed from Settings (tier order, every page), icon socials; under the header after a change', async ({ browser }) => {
  test.setTimeout(300_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Chrome League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'sponsors', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
      data: {
        action: 'set_sponsors',
        sponsors: [
          { name: `Partner Pizza ${stamp}`, tier: 'partner' },
          { name: `Gold Motors ${stamp}`, tier: 'gold', url: 'https://example.com/gold' },
        ],
      },
    });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_contact', social: { instagram: 'https://instagram.com/qa_chrome' } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The manager places the bar from the editor's Settings.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const panel = page.locator('[data-sb-settings-panel]');
      await panel.getByLabel('Show social links').check();
      await panel.locator('[data-sb-sponsor-bar]').selectOption('footer');
      await panel.locator('[data-sb-settings-save]').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Site settings saved' })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
    await publishSite(ownerApi, 'league', leagueId, 'Sponsor bar');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
    try {
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      const home = await settleBody(anon.request, base, 'data-site-sponsor-bar="footer"', true, 12);
      // Top tier first.
      const bar = home.slice(home.indexOf('data-site-sponsor-bar='));
      expect(bar.indexOf(`Gold Motors ${stamp}`)).toBeGreaterThan(-1);
      expect(bar.indexOf(`Gold Motors ${stamp}`)).toBeLessThan(bar.indexOf(`Partner Pizza ${stamp}`));
      // … on every page: the news page carries it too.
      const news = await settleBody(anon.request, `${base}/news`, 'data-site-sponsor-bar="footer"', true, 12);
      expect(news).toContain(`Gold Motors ${stamp}`);

      const page = await anon.newPage();
      await page.goto(base);
      const footerSocials = page.locator('footer').getByRole('list', { name: 'Social links' });
      await expect(footerSocials.getByRole('link', { name: 'Instagram' })).toBeVisible();
      await expect(footerSocials.locator('svg')).toHaveCount(1);
      await expect(page.getByRole('region', { name: 'Our sponsors' }).getByRole('link', { name: new RegExp(`Gold Motors ${stamp}`) })).toHaveAttribute('href', 'https://example.com/gold');

      // Under the header now.
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_footer', showSocials: true, sponsorBar: 'header' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      await publishSite(ownerApi, 'league', leagueId, 'Bar under the header');
      const moved = await settleBody(anon.request, base, 'data-site-sponsor-bar="header"', true, 12);
      expect(moved.indexOf('data-site-sponsor-bar="header"')).toBeLessThan(moved.indexOf('<main'));

      // Phone width: the strip never pushes the page sideways.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base);
      await expect(page.getByRole('region', { name: 'Our sponsors' })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
