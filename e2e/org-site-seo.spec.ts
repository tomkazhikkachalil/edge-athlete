import fs from 'fs';
import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Program 2, C1 (Sep 11 2026): the site's SEO, footer and icon through the
// API — set_seo / set_footer / set_theme iconPath into the draft, publish,
// then the public head and footer carry them: <title>, the description, the
// social image, the icon, the footer line + links + socials, the page's
// title heads with the SEO title. Skips until migration 186 has run.

test('org site seo + footer + icon: the draft writes, publish, the public head and footer; the page title; the vanity twin; 375px', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Seo League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  let assetPath: string | null = null;
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const { subdomain, id: siteId } = (await res.json()).site as { subdomain: string; id: string };
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const { error: probeError } = await admin.from('org_sites').select('seo_config').eq('id', siteId).maybeSingle();
    test.skip(probeError?.code === '42703', 'org_sites.seo_config missing — run migration 186');

    // An uploaded image for the social card and the icon.
    const upload = await ownerApi.post(`/api/leagues/${leagueId}/site/assets`, {
      multipart: { image: { name: 'seo.png', mimeType: 'image/png', buffer: fs.readFileSync('e2e/fixtures/photo.png') } },
    });
    expect(upload.status(), await readErrorBody(upload)).toBe(200);
    assetPath = (await upload.json()).path as string;
    // A foreign image path is refused on both writes.
    expect((await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_seo', imagePath: 'org-media/00000000-0000-4000-8000-000000000000/x.png' } })).status()).toBe(400);
    expect((await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_theme', accent: null, iconPath: 'org-media/00000000-0000-4000-8000-000000000000/x.png' } })).status()).toBe(400);
    // The draft writes.
    for (const data of [
      { action: 'set_seo', title: `Seo League ${stamp}`, description: `Ice on the river ${stamp}`, imagePath: assetPath },
      { action: 'set_footer', text: `Est. ${stamp}`, links: [{ label: `Rules ${stamp}`, url: 'https://example.com/rules' }], showSocials: true },
      { action: 'set_contact', social: { instagram: 'https://instagram.com/qa-seo-league' } },
      { action: 'set_theme', accent: null, iconPath: assetPath },
    ]) {
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    }
    // A page heads with the SEO title.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'add_page', title: `About ${stamp}`, slug: `about-${stamp}` } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const pageId = (await res.json()).page.id as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_page', pageId, visibility: 'public' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId, 'Seo');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pathFor = async (sub: string) => {
        const probe = await anon.request.get(`/org/${sub}`, { maxRedirects: 0 });
        return probe.status() === 301 ? `/${sub}` : `/org/${sub}`;
      };
      const base = await pathFor(subdomain);
      const html = await settleBody(anon.request, base, `Est. ${stamp}`);
      expect(html).toContain(`<title>Seo League ${stamp}</title>`);
      expect(html).toContain(`content="Ice on the river ${stamp}"`);
      const file = assetPath.split('/').pop()!;
      expect(html).toMatch(new RegExp(`property="og:image" content="[^"]*/api/media/org-media/${siteId}/${file}"`));
      expect(html).toMatch(new RegExp(`rel="icon" href="[^"]*/api/media/org-media/${siteId}/${file}"`));
      const footer = html.slice(html.indexOf('data-site-footer'));
      expect(footer).toContain(`Est. ${stamp}`);
      expect(footer).toContain(`Rules ${stamp}`);
      expect(footer).toContain('https://instagram.com/qa-seo-league');
      expect(footer).toContain('Powered by');
      const pageHtml = await settleBody(anon.request, `${base}/about-${stamp}`, `About ${stamp} — Seo League ${stamp}`);
      expect(pageHtml).toContain(`<title>About ${stamp} — Seo League ${stamp}</title>`);
      // The other route tree answers the same head.
      const twin = base.startsWith('/org/') ? `/${subdomain}` : `/org/${subdomain}`;
      const twinRes = await anon.request.get(twin, { maxRedirects: 0 });
      expect([200, 301]).toContain(twinRes.status());
      if (twinRes.status() === 200) expect(await twinRes.text()).toContain(`<title>Seo League ${stamp}</title>`);
      // 375px: the footer inside the viewport.
      const page = await anon.newPage();
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(base);
      await expect(page.getByText(`Est. ${stamp}`)).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    if (assetPath) await admin.storage.from('uploads').remove([assetPath]).catch(() => {});
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
