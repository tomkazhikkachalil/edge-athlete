import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, settleBody } from './helpers/isr';

// Site Builder program 3, D2 — the sponsors: edited in the editor (name,
// link, tier from the fixed ladder, order), saved whole through
// set_sponsors, and presented along the display axes — a grid, grouped by
// tier, no links. The console keeps a pointer only.

test('org site sponsors: the panel edits the list with tiers and order, saves it; grid + grouped + unlinked reaches the published page', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Sponsors League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // The action takes a tier from the ladder only.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_sponsors', sponsors: [{ name: 'Odd', tier: 'diamond' }] } });
    expect(res.status()).toBe(400);

    const names = ['Gold Co', 'Silver Co', 'Plat Co'].map(n => `${n} ${stamp}`);
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-sb-instance][data-sb-widget="sponsors"] .sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      const panel = page.locator('[data-sb-panel="sponsors"]');
      await expect(panel).toBeVisible();
      const list = panel.locator('[data-sb-sponsors]');
      await expect(list).toBeVisible();

      // Three sponsors: gold, silver, platinum — then platinum moved to the top.
      const tiers = ['gold', 'silver', 'platinum'];
      for (let i = 0; i < names.length; i++) {
        await list.locator('[data-sb-sponsor-add]').click();
        await list.getByLabel(`Sponsor ${i + 1} name`).fill(names[i]);
        await list.getByLabel(`Sponsor ${i + 1} link`).fill(`https://sponsor-${i + 1}.example.com`);
        await list.getByLabel(`Sponsor ${i + 1} tier`).selectOption(tiers[i]);
      }
      await list.getByLabel('Move sponsor 3 up').click();
      await list.getByLabel('Move sponsor 2 up').click();
      await expect(list.getByLabel('Sponsor 1 name')).toHaveValue(names[2]);
      await page.getByRole('button', { name: 'Save content' }).click();
      await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled({ timeout: 20_000 });
      // The canvas re-read the site: the sponsors tile lists them, un-chipped.
      const tile = page.locator('[data-sb-instance][data-sb-widget="sponsors"]');
      await expect(tile).toContainText(names[2]);
      await expect(tile.locator('[data-sb-sample-chip]')).toHaveCount(0);

      // How it looks: a grid of two per row, grouped by tier, no links.
      const looks = panel.locator('[data-sb-display-fields]');
      await looks.locator('[data-sb-display="variant"]').selectOption('grid');
      await looks.locator('[data-sb-display="perRow"]').fill('2');
      await looks.locator('[data-sb-display="groupByTier"]').check();
      await looks.locator('[data-sb-display="click"]').selectOption('none');
      await awaitDraftSaved(page);
      await expect(tile.locator('[data-sponsor-groups="3"]')).toBeVisible();
      await expect(tile.locator('[data-variant="grid"]').first()).toBeVisible();
      await expect(tile.locator('a')).toHaveCount(0);

      // The stored list carries the tiers and the order; the display, the axes.
      const site = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { site: { modules: { module_key: string; config: { sponsors?: { name: string; tier?: string }[] } }[] }; layout: { widgets: { key: string; config: { display?: Record<string, unknown> } }[] } };
      const stored = site.site.modules.find(m => m.module_key === 'sponsors')!.config.sponsors!;
      expect(stored.map(s => s.name)).toEqual([names[2], names[0], names[1]]);
      expect(stored.map(s => s.tier)).toEqual(['platinum', 'gold', 'silver']);
      expect(site.layout.widgets.find(w => w.key === 'sponsors')!.config.display).toEqual({ variant: 'grid', perRow: 2, groupByTier: true, click: 'none' });
      // The generated schema refuses eight per row.
      const bad = { ...site.layout, widgets: site.layout.widgets.map(w => (w.key === 'sponsors' ? { ...w, config: { ...w.config, display: { perRow: 8 } } } : w)) };
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: bad } });
      expect(res.status()).toBe(400);
    } finally {
      await ctx.close();
    }

    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, 'data-sponsor-groups="3"', true);
      const at = html.indexOf('data-sponsor-groups="3"');
      const block = html.slice(at, html.indexOf('</section>', html.indexOf('data-sponsor-tier="silver"', at)));
      // The ladder's order: platinum, gold, silver — and no link anywhere in the block.
      expect(block.indexOf('data-sponsor-tier="platinum"')).toBeLessThan(block.indexOf('data-sponsor-tier="gold"'));
      expect(block.indexOf('data-sponsor-tier="gold"')).toBeLessThan(block.indexOf('data-sponsor-tier="silver"'));
      expect(block).toContain('data-variant="grid"');
      expect(block).not.toContain('sponsor-1.example.com');
      expect(block).not.toMatch(/<a\s/);
      for (const n of names) expect(block).toContain(n);
    } finally {
      await anon.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
