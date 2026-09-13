import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, settleBody } from './helpers/isr';

// Site Builder program 3, H1 — section height on the public page. `h` is
// a minimum: an auto section grows to its content (the grid's tracks are
// minmax(row, auto)); a FIXED section keeps exactly its rows on a desktop
// and scrolls inside — CSS only. On a phone (one column, `h` ignored) a
// fixed section still grows.

const PARAGRAPHS = Array.from({ length: 12 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i + 1}: enough words to fill a line or two of a text section so that twelve of them stand well past three rows of the grid.` }));

test('org site fit: an auto section grows to its content; a fixed one keeps its rows and scrolls inside on a desktop, grows on a phone', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Fit League ${stamp}`, sport_key: 'soccer', owner_profile_id: owner.id })
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

    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: Record<string, unknown>; visibility: string }[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const id = 'w_h10000000000001';
    const textAt = (display: Record<string, unknown>) => ({
      ...canvas.layout,
      widgets: [...canvas.layout.widgets, { id, key: 'text', x: 0, y: bottom, w: 12, h: 3, cv: 1, visibility: 'public', config: { title: `Long read ${stamp}`, blocks: PARAGRAPHS, display } }],
    });

    // Auto (the default): published, the section is as tall as its content.
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: textAt({}) } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
    try {
      await settleBody(anon.request, `/org/${subdomain}`, `Long read ${stamp}`, true);
      const page = await anon.newPage();
      await page.goto(`/org/${subdomain}`);
      const section = page.locator(`[data-widget-id="${id}"]`);
      await expect(section).toHaveAttribute('data-sb-fit', 'auto');
      const auto = await section.evaluate(el => ({ height: el.getBoundingClientRect().height, body: el.querySelector('.sb-body')!, scroll: el.querySelector('.sb-body')!.scrollHeight, client: el.querySelector('.sb-body')!.clientHeight }));
      expect(auto.height).toBeGreaterThan(168 + 100); // well past three rows (168px)
      expect(auto.scroll).toBeLessThanOrEqual(auto.client + 1); // nothing hidden
    } finally {
      await anon.close();
    }

    // Fixed: three rows exactly, the body scrolls; the schema takes the axis.
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: textAt({ height: 'fixed' }) } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: textAt({ height: 'tall' }) } });
    expect(res.status()).toBe(400);
    await publishSite(ownerApi, 'league', leagueId);
    const desktop = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 900 } });
    try {
      await settleBody(desktop.request, `/org/${subdomain}`, `data-widget-id="${id}" data-sb-fit="fixed"`, true);
      const page = await desktop.newPage();
      await page.goto(`/org/${subdomain}`);
      const section = page.locator(`[data-widget-id="${id}"]`);
      await expect(section).toHaveAttribute('data-sb-fit', 'fixed');
      const fixed = await section.evaluate(el => ({ height: el.getBoundingClientRect().height, scroll: el.querySelector('.sb-body')!.scrollHeight, client: el.querySelector('.sb-body')!.clientHeight, overflow: getComputedStyle(el.querySelector('.sb-body')!).overflowY }));
      expect(Math.round(fixed.height)).toBe(168); // 3 × 40 + 2 × 24
      expect(fixed.overflow).toBe('auto');
      expect(fixed.scroll).toBeGreaterThan(fixed.client + 40);
    } finally {
      await desktop.close();
    }
    const phone = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });
    try {
      const page = await phone.newPage();
      await page.goto(`/org/${subdomain}`);
      const section = page.locator(`[data-widget-id="${id}"]`);
      const grown = await section.evaluate(el => ({ height: el.getBoundingClientRect().height, scroll: el.querySelector('.sb-body')!.scrollHeight, client: el.querySelector('.sb-body')!.clientHeight }));
      expect(grown.height).toBeGreaterThan(168 + 100);
      expect(grown.scroll).toBeLessThanOrEqual(grown.client + 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
    } finally {
      await phone.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});

test('org site fit (canvas, H2): a tile grows to its content; dragging it below the content makes it fixed with an Undo; the phone list has the height rule', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Canvas Fit ${stamp}`, sport_key: 'soccer', owner_profile_id: owner.id })
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
    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: Record<string, unknown>; visibility: string }[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const id = 'w_h20000000000001';
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...canvas.layout.widgets, { id, key: 'text', x: 0, y: bottom, w: 12, h: 3, cv: 1, visibility: 'public', config: { title: `Long read ${stamp}`, blocks: PARAGRAPHS } }] } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const tile = page.locator(`[data-sb-instance="${id}"]`);
      await expect(tile).toHaveAttribute('data-sb-fit', 'auto');
      // The tile grew to its content: taller than three rows, nothing clipped.
      await expect.poll(async () => (await tile.boundingBox())!.height, { timeout: 15_000 }).toBeGreaterThan(168 + 100);
      const clipped = await tile.locator('.sb-widget-body').evaluate(el => el.scrollHeight > el.clientHeight + 1);
      expect(clipped).toBe(false);
      // …and the stored h is still the minimum (the draft never carries the measured height).
      const before = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; h: number; config: Record<string, unknown> }[] } };
      expect(before.layout.widgets.find(w => w.id === id)!.h).toBe(3);

      // Drag the resize handle up by 300px (more than a row): below the
      // content → fixed, with the toast. The handle sits at the tile's foot,
      // below the fold — hover scrolls it into view, so read its box AFTER.
      const handle = tile.locator('.react-resizable-handle-se');
      await handle.hover();
      const hb = (await handle.boundingBox())!;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 300, { steps: 10 });
      await page.mouse.up();
      await expect(tile).toHaveAttribute('data-sb-fit', 'fixed');
      await expect(tile.locator('[data-sb-fixed-chip]')).toBeVisible();
      await expect(page.getByText('Fixed height — this section scrolls inside')).toBeVisible();
      await awaitDraftSaved(page);
      const after = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; h: number; config: { display?: { height?: string } } }[] } };
      const stored = after.layout.widgets.find(w => w.id === id)!;
      expect(stored.config.display?.height).toBe('fixed');
      expect(stored.h).toBeLessThan(6);
      // The fixed tile's body scrolls in the editor too.
      const scrolls = await tile.locator('.sb-widget-body').evaluate(el => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY === 'auto');
      expect(scrolls).toBe(true);
      // Undo from the toast: back to auto at the old minimum.
      await page.getByRole('button', { name: 'Undo' }).last().click();
      await expect(tile).toHaveAttribute('data-sb-fit', 'auto');
      await awaitDraftSaved(page);
      const undone = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; h: number; config: { display?: { height?: string } } }[] } };
      expect(undone.layout.widgets.find(w => w.id === id)!.h).toBe(3);
      expect(undone.layout.widgets.find(w => w.id === id)!.config.display?.height).toBeUndefined();
    } finally {
      await ctx.close();
    }

    // The phone list carries the rule as a select.
    const phone = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await phone.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      const row = page.locator(`[data-sb-section="${id}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.locator('[data-sb-height]').selectOption('fixed');
      await awaitDraftSaved(page);
      const draft = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; config: { display?: { height?: string } } }[] } };
      expect(draft.layout.widgets.find(w => w.id === id)!.config.display?.height).toBe('fixed');
    } finally {
      await phone.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
