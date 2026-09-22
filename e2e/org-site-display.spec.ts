import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, settleBody } from './helpers/isr';

// Site Builder program 3, D1 — display settings inside a section. The
// panel's "How it looks" fieldset is generated from the widget's
// declaration; the values ride the instance's `display` key, autosave with
// the layout, and the public page renders them: a manager's own team
// order, a variant, a click action and a count.

test('org site display: teams reordered by hand, tiles, no links; staff count — the panel writes display, publish renders it', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Display League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  const names = ['Wolves', 'Comets', 'Hawks'].map(n => `${n} ${stamp}`);
  const { error: teamsError } = await admin.from('teams').insert(names.map(name => ({ league_id: leagueId, name })));
  expect(teamsError, teamsError?.message).toBeNull();

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // The draft PUT validates display against the GENERATED schema.
    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; key: string; config: Record<string, unknown> }[] } };
    const teamsW = canvas.layout.widgets.find(w => w.key === 'teams')!;
    const bad = { ...canvas.layout, widgets: canvas.layout.widgets.map(w => (w.id === teamsW.id ? { ...w, config: { ...w.config, display: { variant: 'sideways' } } } : w)) };
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: bad } });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('teams');

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000); // an action that cannot complete names itself rather than eating the test timeout
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });

      // Teams: tiles, my own order (Hawks first), no links.
      await page.locator('[data-sb-instance][data-sb-widget="teams"] .sb-frame-controls').click();
      const panel = page.locator('[data-sb-panel="teams"]');
      await expect(panel).toBeVisible();
      const looks = panel.locator('[data-sb-display-fields]');
      await expect(looks).toBeVisible();
      await looks.locator('[data-sb-display="variant"]').selectOption('tiles');
      await looks.locator('[data-sb-display="click"]').selectOption('none');
      await looks.locator('[data-sb-display="sort"]').selectOption('manual');
      const reorder = looks.locator('[data-sb-reorder]');
      await expect(reorder).toBeVisible();
      await expect(reorder.locator('[data-sb-reorder-item]')).toHaveCount(3);
      // The default order is the reader's (alphabetical) — move Hawks up until it leads.
      const up = reorder.locator(`[data-sb-reorder-item] [data-sb-reorder-up][aria-label="Move ${names[2]} up"]`);
      for (let i = 0; i < 3 && !(await up.isDisabled()); i++) await up.click();
      await expect(up).toBeDisabled();
      await expect(reorder.locator('[data-sb-reorder-item]').first()).toContainText(names[2]);
      await awaitDraftSaved(page);

      // The canvas tile already renders the variant and the order.
      const tile = page.locator('[data-sb-instance][data-sb-widget="teams"]');
      await expect(tile.locator('[data-variant="tiles"]')).toBeVisible();
      await expect(tile.locator('[data-variant="tiles"] > *').first()).toContainText(names[2]);
      await expect(tile.locator('[data-variant="tiles"] a')).toHaveCount(0);

      // Staff: a count of… the owner is the only staff — the number input clamps to the declared bounds.
      // The staff tile sits under the sticky panel at this scroll position —
      // select it by keyboard (the frame header is a button; B4).
      await page.locator('[data-sb-instance][data-sb-widget="staff"] .sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      const staffPanel = page.locator('[data-sb-panel="staff"]');
      await expect(staffPanel).toBeVisible();
      await staffPanel.locator('[data-sb-display="variant"]').selectOption('grid');
      await staffPanel.locator('[data-sb-display="count"]').fill('99');
      await expect(staffPanel.locator('[data-sb-display="count"]')).toHaveValue('20');
      await awaitDraftSaved(page);

      const draft = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; config: { display?: Record<string, unknown> } }[] } };
      const teamsDisplay = draft.layout.widgets.find(w => w.key === 'teams')!.config.display!;
      expect(teamsDisplay.variant).toBe('tiles');
      expect(teamsDisplay.click).toBe('none');
      expect(teamsDisplay.sort).toBe('manual');
      expect((teamsDisplay.order as string[])[0]).toBeDefined();
      expect(draft.layout.widgets.find(w => w.key === 'staff')!.config.display).toEqual({ variant: 'grid', count: 20 });
    } finally {
      await ctx.close();
    }

    // Published: the public page renders the tiles in the manager's order, without links.
    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, 'data-variant="tiles"', true);
      const tiles = html.indexOf('data-variant="tiles"');
      const teamsBlock = html.slice(tiles, html.indexOf('</div>', tiles));
      expect(teamsBlock).not.toContain('<a ');
      expect(teamsBlock.indexOf(names[2])).toBeLessThan(teamsBlock.indexOf(names[0]));
      expect(html).toContain('data-variant="grid"');
    } finally {
      await anon.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

test('@mobile org site display: the "How it looks" fieldset sits in the phone sheet', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Display Phone ${stamp}`, sport_key: 'soccer', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      const list = page.locator('[data-sb-sections]');
      await expect(list).toBeVisible({ timeout: 30_000 });
      await list.locator('[data-sb-section-key="standings"] [data-sb-edit]').click();
      const sheet = page.locator('[data-larger-window="sb-panel"]');
      await expect(sheet).toBeVisible();
      const looks = sheet.locator('[data-sb-display-fields]');
      await expect(looks).toBeVisible();
      await looks.locator('[data-sb-display="variant"]').selectOption('full');
      await looks.locator('[data-sb-display="count"]').fill('8');
      await awaitDraftSaved(page);
      const draft = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; config: { display?: Record<string, unknown> } }[] } };
      expect(draft.layout.widgets.find(w => w.key === 'standings')!.config.display).toEqual({ variant: 'full', count: 8 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
    } finally {
      await ctx.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
