import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// The public org site shell (phase 3, round 1): create → publish → the
// anonymous /org/{slug} document renders from the (public) segment;
// unpublish → 404 again. The subdomain is minted from the org name
// against the shared reserved denylist; drafts are invisible; a member
// without manage_org gets 403 from the site API.
test('org site: create → publish → anon shell; unpublish → 404; member 403; 375px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const member = loadQaUser('user.json');
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();

  const probe = await admin.from('org_sites').select('id').limit(1);
  test.skip(!!probe.error, `org_sites missing — run migration 155 (${probe.error?.message})`);

  const stamp = Date.now();
  const name = `QA Site League ${stamp}`;
  const { data: league } = await admin
    .from('leagues')
    .insert({ name, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select()
    .single();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([
    { league_id: leagueId, profile_id: owner.id, role: 'owner' },
    { league_id: leagueId, profile_id: member.id, role: 'member' },
  ]);

  try {
    // Owner drives the console: create + publish.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    let subdomain = '';
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Create your site' }).click();
      await expect(page.getByText('draft — publish to go live')).toBeVisible({ timeout: 15_000 });

      const { data: siteRow } = await admin
        .from('org_sites')
        .select('subdomain, published_at')
        .eq('league_id', leagueId)
        .single();
      subdomain = siteRow!.subdomain as string;
      // Minted from the org name; DNS-label shaped.
      expect(subdomain).toMatch(/^qa-site-league-\d+$/);
      expect(siteRow!.published_at).toBeNull();

      // Draft is invisible to the world.
      const anonProbe = await page.request.get(`/org/${subdomain}`);
      expect(anonProbe.status()).toBe(404);

      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('published', { exact: true })).toBeVisible({ timeout: 15_000 });

      // 375px: the Website card stays usable.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByText(`/org/${subdomain}`)).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);
    } finally {
      await ctx.close();
    }

    // The anonymous document: org name in the RAW HTML (the ISR shell),
    // module stubs present, metadata title set.
    const ctxAnon = await browser.newContext();
    try {
      const page = await ctxAnon.newPage();
      const htmlRes = await page.request.get(`/org/${subdomain}`);
      expect(htmlRes.status()).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain(name);
      expect(html).toContain('Standings');
      expect(html).toContain('Powered by');

      // In a browser at 375px: renders and stays inside the viewport.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/org/${subdomain}`);
      await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 15_000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(375);

      // The document tree is the (public) segment: no theme script stamp,
      // no app chrome.
      expect(html).not.toContain('data-theme');
      expect(html).not.toContain('Notifications');
    } finally {
      await ctxAnon.close();
    }

    // Member (no manage_org): the site API 403s.
    const memberApi = await apiAs('state.json');
    try {
      const res = await memberApi.post(`/api/leagues/${leagueId}/site`);
      expect(res.status(), await readErrorBody(res)).toBe(403);
    } finally {
      await memberApi.dispose();
    }

    // Unpublish → the world 404s again (revalidateTag makes it immediate).
    const ownerApi = await apiAs('state-b.json');
    try {
      const res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'unpublish' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
    } finally {
      await ownerApi.dispose();
    }
    const ctxAnon2 = await browser.newContext();
    try {
      const page2 = await ctxAnon2.newPage();
      const gone = await page2.request.get(`/org/${subdomain}?_cb=${Date.now()}`);
      expect(gone.status()).toBe(404);
    } finally {
      await ctxAnon2.close();
    }
  } finally {
    // League delete cascades the site (and its modules/pages).
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
