import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, pollUntil } from './helpers/isr';

// The Sections list — the phone editor (Sep 11 2026). Below lg the editor's
// main is the SAME draft as a list in reading order: Move up / Move down and a
// named size per section, each one undo step autosaved like a drag. After
// publishing, the public page renders the list's order and the resized tile's
// column span — the list shows what the phone shows.

type Canvas = { layout: { widgets: { id: string; key: string; x: number; y: number; w: number }[] }; draft: unknown };
const reading = (c: Canvas) => [...c.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x);

test('@mobile org site sections: the phone editor lists the draft; Move down and Size re-flow it; publish renders the new order', async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const { data: league, error } = await admin
    .from('leagues')
    .insert({ name: `QA Sections League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const leagueId = league!.id as string;
  await admin.from('memberships').insert([{ league_id: leagueId, profile_id: owner.id, role: 'owner' }]);
  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    // Live first: the public page is read at the end (and the gallery's
    // first-open offer only meets a never-published site).
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    const before = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    const orderBefore = reading(before).map(w => w.id);
    expect(orderBefore.length).toBeGreaterThan(3);
    expect(reading(before)[0].key).toBe('hero');

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      const list = page.locator('[data-sb-sections]');
      await expect(list).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-canvas]')).toBeHidden();
      const rows = list.locator('[data-sb-section]');
      await expect(rows).toHaveCount(orderBefore.length);
      // The rows ARE the reading order; the hero leads and has no controls.
      expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-sb-section')))).toEqual(orderBefore);
      await expect(rows.first()).toHaveAttribute('data-sb-section-key', 'hero');
      await expect(rows.first().locator('[data-sb-move]')).toHaveCount(0);
      // Just under the hero: "up" is refused (nothing moves above the hero); the last has no "down".
      await expect(rows.nth(1).locator('[data-sb-move="up"]')).toBeDisabled();
      await expect(rows.last().locator('[data-sb-move="down"]')).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      // Move the first section under the hero down one step → one autosave.
      const movedId = orderBefore[1];
      await rows.nth(1).locator('[data-sb-move="down"]').click();
      await awaitDraftSaved(page);
      const expected = [...orderBefore];
      [expected[1], expected[2]] = [expected[2], expected[1]];
      expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-sb-section')))).toEqual(expected);
      const afterMove = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
      expect(afterMove.draft).not.toBeNull();
      expect(reading(afterMove).map(w => w.id)).toEqual(expected);

      // Size → medium on the STAFF section (a half widget, and the league's
      // owner is on it, so it is never empty — it renders publicly): w = 6.
      const target = list.locator('[data-sb-section-key="staff"]');
      await expect(target).toBeVisible();
      const resizedId = (await target.getAttribute('data-sb-section'))!;
      await expect(target.locator('[data-sb-size="medium"]')).toHaveAttribute('aria-checked', 'false');
      await target.locator('[data-sb-size="medium"]').click();
      await awaitDraftSaved(page);
      await expect(target.locator('[data-sb-size="medium"]')).toHaveAttribute('aria-checked', 'true');
      const afterSize = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
      expect(afterSize.layout.widgets.find(w => w.id === resizedId)!.w).toBe(6);
      const finalOrder = reading(afterSize).map(w => w.id);
      expect(finalOrder.indexOf(movedId)).toBe(2);

      // Undo is one step per list edit: two edits, two undos → the original order.
      await page.getByRole('button', { name: 'Undo' }).click();
      await page.getByRole('button', { name: 'Undo' }).click();
      await awaitDraftSaved(page);
      expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-sb-section')))).toEqual(orderBefore);
      await page.getByRole('button', { name: 'Redo' }).click();
      await page.getByRole('button', { name: 'Redo' }).click();
      await awaitDraftSaved(page);
      expect(await rows.evaluateAll(els => els.map(el => el.getAttribute('data-sb-section')))).toEqual(finalOrder);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      // Publish from the phone header; the public page renders the list's
      // order (module instance ids) and the resized tile's column span.
      await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Changes published' })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
    const published = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as Canvas;
    const moduleIds = reading(published).map(w => w.id);
    expect(published.layout.widgets.find(w => w.id === 'legacy:staff')!.w).toBe(6);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      // ISR settles on the STAFF tile carrying its new span (the style attribute
      // precedes the data attributes on the tile).
      const staffTile = /<[^>]*style="[^"]*--sb-w:\s*6\b[^"]*"[^>]*data-widget-id="legacy:staff"/;
      const html = await pollUntil(async () => (await anon.request.get(`/org/${subdomain}`)).text(), body => staffTile.test(body), { attempts: 12, label: 'the public staff tile spans six columns' });
      const publicIds = [...html.matchAll(/data-widget-id="([^"]+)"/g)].map(m => m[1]);
      // Empty widgets never render publicly: the public sequence is a subsequence of the layout's reading order.
      const kept = moduleIds.filter(id => publicIds.includes(id));
      expect(kept.length).toBeGreaterThanOrEqual(2);
      expect(publicIds.filter(id => kept.includes(id))).toEqual(kept);
    } finally {
      await anon.close();
    }
    // The desktop half lives in org-site-editor.spec.ts (the panel's Size control).
    await publishSite(ownerApi, 'league', leagueId, 'Sections');
  } finally {
    await ownerApi.dispose();
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
