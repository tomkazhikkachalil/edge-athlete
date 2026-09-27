import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Sports-team website program, L2 (Sep 27 2026): the teams section's
// "Crests" layout — each team's crest (its logo, else its initials) under a
// bar in the team's colour (242's identity columns); a team without colours
// wears the site's accent. The header's Teams menu draws the same crests.

test('team crests: the Crests layout wears each team’s colour and initials; the menu shows them too @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Crests League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  const leagueId = league.id;
  try {
    await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);
    const { error } = await admin.from('teams').insert([
      { org_id: leagueId, name: `Kanata Rangers ${stamp}`, primary_color: '#1d4ed8' },
      { org_id: leagueId, name: `U13 Blazers ${stamp}` },
    ]);
    expect(error).toBeNull();

    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_module', moduleKey: 'teams', enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // The teams section → Crests (the draft PUT validates it against the generated schema).
    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as {
      layout: { widgets: { id: string; key: string; config: Record<string, unknown> }[] };
    };
    const teamsW = canvas.layout.widgets.find(w => w.key === 'teams');
    expect(teamsW, 'the seed carries a teams section').toBeTruthy();
    const layout = {
      ...canvas.layout,
      widgets: canvas.layout.widgets.map(w => (w.id === teamsW!.id ? { ...w, config: { ...w.config, display: { variant: 'crests' } } } : w)),
    };
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId, 'Crests');

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    try {
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      await settleBody(anon.request, base, 'data-variant="crests"', true, 12);

      const page = await anon.newPage();
      await page.goto(base);
      const grid = page.locator('main [data-variant="crests"]');
      await expect(grid).toBeVisible();
      const rangers = grid.locator('a', { hasText: `Kanata Rangers ${stamp}` });
      await expect(rangers).toContainText('KR'); // the initials crest (no logo)
      // The colour bar wears the team's colour …
      const bar = await rangers.locator('span[aria-hidden="true"]').first().evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bar).toBe('rgb(29, 78, 216)');
      // … and a team without colours reads "B" (age token skipped) on the site accent.
      await expect(grid.locator('a', { hasText: `U13 Blazers ${stamp}` })).toContainText('B');

      // The header menu lists the teams with their crests.
      await page.locator('[data-site-menu] > summary').click();
      const sheet = page.getByRole('navigation', { name: 'Site menu' });
      await sheet.locator('summary', { hasText: 'Teams' }).click();
      await expect(sheet.getByRole('link', { name: `Kanata Rangers ${stamp}` })).toContainText('KR');

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
