import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { revisionsSupported } from './helpers/org-site';

// Site Builder P3-B: the grid editor behind FEATURE_SITE_BUILDER. Skips
// (green) when the target build has the flag off (the canvas route answers
// 404 "Not available") or lacks migration 180. With both: the canvas loads
// the real page as tiles, a drag commits a layout the draft stores (rev
// bumps), undo restores, the layout survives a reload, the phone shows the
// notice with working doors, and the public page is untouched.

test('org site editor: canvas → drag → autosave → undo → reload; phone notice; public untouched', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Editor League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
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
    const canvasRes = await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`);
    test.skip(canvasRes.status() === 404, 'FEATURE_SITE_BUILDER is off for this build');
    expect(canvasRes.status(), await readErrorBody(canvasRes)).toBe(200);
    const canvas = (await canvasRes.json()) as { layout: { widgets: { id: string; key: string; x: number; y: number; w: number }[] }; draft: unknown };
    // No draft yet: the layout is the linear projection (full-width rows).
    expect(canvas.draft).toBeNull();
    expect(canvas.layout.widgets.length).toBeGreaterThan(3);
    expect(canvas.layout.widgets.every(w => w.w === 12 && w.x === 0)).toBe(true);

    // The draft PUT validates: a hero of width 6 is refused; an overlap is refused.
    const bad = canvas.layout.widgets.map(w => (w.key === 'hero' ? { ...w, w: 6 } : w));
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: bad } } });
    expect(res.status()).toBe(400);

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const publicBefore = await (await anon.request.get(`/org/${subdomain}`)).text();

    const ownerCtx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ownerCtx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      const canvasEl = page.locator('[data-sb-canvas]');
      await expect(canvasEl).toBeVisible({ timeout: 30_000 });
      const tiles = page.locator('[data-sb-instance]');
      await expect(tiles.first()).toBeVisible();
      const count = await tiles.count();
      expect(count).toBe(canvas.layout.widgets.length);
      // The tiles carry the REAL page: the hero shows the org's name.
      await expect(page.locator('[data-sb-widget="hero"]')).toContainText(`QA Editor League ${stamp}`);
      await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

      // Drag the second tile down by two rows: one gesture, one undo step, one autosave.
      const second = tiles.nth(1);
      const handle = second.locator('.sb-frame-controls');
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 200, { steps: 12 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({ timeout: 10_000 });
      await expect(page.locator('[data-sb-status="saved"]')).toBeVisible({ timeout: 15_000 });

      // The draft stores the layout (rev bumped, layout present) — and the
      // draft is dirty against the published rows.
      const after = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as {
        layout: { widgets: { id: string; y: number }[] };
        draft: { rev: number; hasUnpublishedChanges: boolean } | null;
      };
      expect(after.draft).not.toBeNull();
      expect(after.draft!.rev).toBeGreaterThanOrEqual(2);
      const orderBefore = canvas.layout.widgets.map(w => w.id);
      const orderAfter = [...after.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id);
      expect(orderAfter).not.toEqual(orderBefore);

      // Undo → the original order comes back and saves again.
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('[data-sb-status="saved"]')).toBeVisible({ timeout: 15_000 });
      const undone = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...undone.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderBefore);

      // Redo, then reload: the moved layout survives.
      await page.getByRole('button', { name: 'Redo' }).click();
      await expect(page.locator('[data-sb-status="saved"]')).toBeVisible({ timeout: 15_000 });
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const reloaded = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...reloaded.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderAfter);

      // The phone: the notice with working doors, no overflow.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByRole('heading', { name: 'The editor needs a bigger screen' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Preview draft' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish changes' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to the console' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      // The public page is untouched by draft layout edits.
      const publicAfter = await (await anon.request.get(`/org/${subdomain}`)).text();
      const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<meta name="(sentry-trace|baggage)"[^>]*>/g, '');
      expect(strip(publicAfter)).toBe(strip(publicBefore));

      // The console door.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/app/org/league/${leagueId}`);
      await expect(page.getByRole('link', { name: 'Open the editor →' })).toBeVisible({ timeout: 20_000 });
    } finally {
      await ownerCtx.close();
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
