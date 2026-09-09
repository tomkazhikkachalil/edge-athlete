import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { revisionsSupported } from './helpers/org-site';

// Site Builder P3-B: the grid editor behind FEATURE_SITE_BUILDER. Skips
// (green) when the target build has the flag off (the canvas route answers
// 404 "Not available") or lacks migration 180. With both: the canvas loads
// the real page as tiles, a drag commits a layout the draft stores (rev
// bumps), undo restores, the layout survives a reload, the phone shows the
// notice with working doors, and the public page is untouched.

/** One autosave cycle: the header goes dirty (the edit), then clean + saved
 *  (the PUT landed). Waiting on "saved" alone races the previous cycle. */
async function awaitSaved(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-sb-dirty="1"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-sb-dirty="0"][data-sb-status="saved"]')).toBeVisible({ timeout: 15_000 });
}

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
      await awaitSaved(page);

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
      await awaitSaved(page);
      const undone = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...undone.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderBefore);

      // Redo, then reload: the moved layout survives.
      await page.getByRole('button', { name: 'Redo' }).click();
      await awaitSaved(page);
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const reloaded = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...reloaded.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderAfter);

      // P3-D: remove a tile → an Undo toast (no confirm dialog) → Undo restores it.
      const before = await page.locator('[data-sb-instance]').count();
      const removable = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      const removedKey = await removable.getAttribute('data-sb-widget');
      await removable.getByRole('button', { name: /^Remove / }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before - 1);
      const toast = page.getByRole('alert').filter({ hasText: 'Section removed' });
      await expect(toast).toBeVisible();
      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before);
      await expect(page.locator(`[data-sb-widget="${removedKey}"]`)).toBeVisible();
      // Remove again (for real), then add it back from the picker — tiles preview the club's data.
      await page.locator(`[data-sb-widget="${removedKey}"]`).getByRole('button', { name: /^Remove / }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before - 1);
      await awaitSaved(page);
      await page.getByRole('button', { name: 'Add section' }).click();
      const picker = page.locator('[data-larger-window="sb-picker"]');
      await expect(picker).toBeVisible();
      const tile = picker.locator(`[data-sb-picker-tile="${removedKey}"]`);
      await expect(tile).toBeVisible({ timeout: 20_000 });
      await expect(tile.getByRole('button', { name: 'Add' })).toBeEnabled({ timeout: 20_000 });
      await tile.getByRole('button', { name: 'Add' }).click();
      await expect(picker).toBeHidden();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before);
      await expect(page.locator(`[data-sb-widget="${removedKey}"]`)).toBeVisible();
      await awaitSaved(page);
      const readded = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; id: string }[] } };
      expect(readded.layout.widgets.filter(w => w.key === removedKey)).toHaveLength(1);
      expect(readded.layout.widgets.find(w => w.key === removedKey)!.id).toMatch(/^w_[0-9a-f]{16}$/);

      // Phase 5: the properties panel. Select a tile → its title is an INSTANCE
      // option (one undo step, autosaved, the heading updates live). The
      // STAFF tile: the league's owner is on it, so it is never empty and the
      // renamed heading reaches the public page ("empty never renders" drops
      // e.g. a fresh league's standings tile, title and all).
      const targetKey = 'staff';
      const target = page.locator(`[data-sb-widget="${targetKey}"]`);
      await expect(target).toBeVisible();
      await target.locator('.sb-frame-controls').click();
      const panel = page.locator(`[data-sb-panel="${targetKey}"]`);
      await expect(panel).toBeVisible();
      await panel.getByLabel('Section title').fill(`Our ${targetKey} ${stamp}`);
      await expect(target.locator('.sb-frame-controls')).toContainText(`Our ${targetKey} ${stamp}`);
      await awaitSaved(page);
      // The hero's CONTENT goes through set_hero (the console's own write) and the canvas re-reads it.
      await page.locator('[data-sb-widget="hero"] .sb-frame-controls').click();
      const heroPanel = page.locator('[data-sb-panel="hero"]');
      await expect(heroPanel).toBeVisible();
      await heroPanel.getByLabel('Headline').fill(`Hello ${stamp}`);
      await heroPanel.getByRole('button', { name: 'Save content' }).click();
      await expect(page.locator('[data-sb-widget="hero"]')).toContainText(`Hello ${stamp}`, { timeout: 20_000 });
      // The console's GET sees the same draft content (one write, two surfaces).
      const draftView = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { hero_config: { headline?: string } } };
      expect(draftView.site.hero_config.headline).toBe(`Hello ${stamp}`);

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

      // P3-C closes the loop: publish → the public grid renders the moved layout
      // in reading order (the DOM order of the tiles follows the coordinates).
      res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'publish', label: 'Arranged' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const finalLayout = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; y: number; x: number }[] } };
      const publishedOrder = [...finalLayout.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.key);
      let publicHtml = '';
      await expect
        .poll(async () => {
          publicHtml = await (await anon.request.get(`/org/${subdomain}`)).text();
          const tiles = [...publicHtml.matchAll(/data-widget="([a-z]+)"/g)].map(m => m[1]);
          // Empty widgets never render publicly — compare the order of the ones that do.
          const expected = publishedOrder.filter(k => tiles.includes(k));
          return JSON.stringify(tiles.filter(k => expected.includes(k))) === JSON.stringify(expected) && tiles.length > 0;
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      expect(publicHtml).toContain('data-sb-grid');
      // Phase 5: the instance title and the hero content both reached the public page.
      expect(publicHtml).toContain(`Our ${targetKey} ${stamp}`);
      expect(publicHtml).toContain(`Hello ${stamp}`);

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
