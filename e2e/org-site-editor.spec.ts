import fs from 'fs';
import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved } from './helpers/isr';

// Site Builder P3-B: the grid editor (the Website section's door since
// P10-C). Skips (green) when the target database lacks migration 180. With both: the canvas loads
// the real page as tiles, a drag commits a layout the draft stores (rev
// bumps), undo restores, the layout survives a reload, the phone shows the
// notice with working doors, and the public page is untouched.

/** One autosave cycle: the header goes dirty (the edit), then clean + saved
 *  (the PUT landed). Waiting on "saved" alone races the previous cycle. */

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
    // B5: an uploaded asset can be reclaimed (DELETE, prefix-asserted); a foreign path is refused.
    const reclaimable = await ownerApi.post(`/api/leagues/${leagueId}/site/assets`, {
      multipart: { image: { name: 'reclaim.png', mimeType: 'image/png', buffer: fs.readFileSync('e2e/fixtures/photo.png') } },
    });
    expect(reclaimable.status(), await readErrorBody(reclaimable)).toBe(200);
    const reclaimPath = (await reclaimable.json()).path as string;
    res = await ownerApi.delete(`/api/leagues/${leagueId}/site/assets`, { data: { path: 'org-media/00000000-0000-4000-8000-000000000000/x.png' } });
    expect(res.status()).toBe(400);
    res = await ownerApi.delete(`/api/leagues/${leagueId}/site/assets`, { data: { path: reclaimPath } });
    expect(res.status(), await readErrorBody(res)).toBe(200);

    // B2: an app-only key is refused at the write with the instance named (the schema is lenient for reads).
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: [...canvas.layout.widgets, { id: 'w_000000000000b2a1', key: 'week', x: 0, y: 99, w: 6, h: 2, cv: 1, config: {}, visibility: 'public' }] } } });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('week: not a site widget');

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

      // Phase 8 (P8-B): the checklist rail — derived: this site is already live
      // (published above) and its staff tile has the owner, so publish + fill
      // are done and the other four are not; a step opens what completes it
      // (the colours step → the theme panel).
      const rail = page.locator('[data-sb-checklist]');
      await expect(rail).toBeVisible();
      await expect(rail).toHaveAttribute('data-sb-checklist-done', '2');
      await expect(rail.locator('[data-sb-checklist-step="publish"]')).toHaveAttribute('data-done', '1');
      await expect(rail.locator('[data-sb-checklist-step="fill"]')).toHaveAttribute('data-done', '1');
      for (const key of ['colours', 'photo', 'welcome', 'arrange']) {
        await expect(rail.locator(`[data-sb-checklist-step="${key}"]`)).toHaveAttribute('data-done', '0');
      }
      await rail.locator('[data-sb-checklist-step="colours"]').click();
      await expect(page.locator('[data-sb-theme-panel]')).toBeVisible();
      await page.getByRole('button', { name: 'Close theme panel' }).click();
      await expect(page.locator('[data-sb-theme-panel]')).toBeHidden();
      // B6: the photo and welcome steps select the hero; the fill step selects the first empty live tile.
      await rail.locator('[data-sb-checklist-step="photo"]').click();
      await expect(page.locator('[data-sb-panel="hero"]')).toBeVisible();
      await rail.locator('[data-sb-checklist-step="welcome"]').click();
      await expect(page.locator('[data-sb-panel="hero"]')).toBeVisible();
      if ((await rail.locator('[data-sb-checklist-step="fill"][data-done="0"]').count()) > 0) {
        await rail.locator('[data-sb-checklist-step="fill"]').click();
        await expect(page.locator('[data-sb-panel]:not([data-sb-panel="hero"])')).toBeVisible();
      }
      await page.locator('[data-sb-widget="hero"] .sb-frame-controls').click();
      await expect(page.locator('[data-sb-panel="hero"]')).toBeVisible();

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
      await awaitDraftSaved(page);
      // The drag arranged the page: that step is done.
      await expect(rail.locator('[data-sb-checklist-step="arrange"]')).toHaveAttribute('data-done', '1');

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
      await awaitDraftSaved(page);
      const undone = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...undone.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderBefore);

      // Redo, then reload: the moved layout survives.
      await page.getByRole('button', { name: 'Redo' }).click();
      await awaitDraftSaved(page);
      await page.reload();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      const reloaded = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; y: number }[] } };
      expect([...reloaded.layout.widgets].sort((a, b) => a.y - b.y).map(w => w.id)).toEqual(orderAfter);

      // H5: resize — drag the second tile's corner handle down two rows; it saves.
      const resizable = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      await resizable.hover();
      const grip = resizable.locator('.react-resizable-handle-se');
      const gripBox = (await grip.boundingBox())!;
      const hBefore = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; h: number }[] } };
      const resizedId = await resizable.getAttribute('data-sb-instance');
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(gripBox.x + gripBox.width / 2 + 3, gripBox.y + gripBox.height / 2 + 3);
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 + 160, { steps: 10 });
      await page.mouse.up();
      await awaitDraftSaved(page);
      const hAfter = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; h: number }[] } };
      expect(hAfter.layout.widgets.find(w => w.id === resizedId)!.h).toBeGreaterThan(hBefore.layout.widgets.find(w => w.id === resizedId)!.h);

      // H5: publish while dirty says WHY — and the chip's status is honest.
      // Drag once more, click Publish inside the debounce.
      const tileForDirty = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      const dirtyHandle = tileForDirty.locator('.sb-frame-controls');
      const dBox = (await dirtyHandle.boundingBox())!;
      await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(dBox.x + dBox.width / 2 + 5, dBox.y + dBox.height / 2 + 5);
      await page.mouse.move(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2 + 260, { steps: 12 });
      await page.mouse.up();
      await expect(page.locator('[data-sb-dirty="1"]')).toBeVisible({ timeout: 5_000 });
      await page.getByRole('button', { name: 'Publish changes' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Saving — one moment, then publish.' })).toBeVisible({ timeout: 5_000 });
      await awaitDraftSaved(page);

      // H5: the conflict path — another session saves the draft; our next
      // edit carries a stale rev → 409 → the chip says so and Reload restores.
      const elsewhere = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: unknown };
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: elsewhere.layout } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      // A deterministic edit: rename a section through its panel (a drag can
      // be a no-op after compaction; a toast can sit over a tile's grip).
      await expect(page.getByRole('alert').filter({ hasText: 'Saving — one moment' })).toHaveCount(0, { timeout: 15_000 });
      const conflictTile = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      const conflictKey = await conflictTile.getAttribute('data-sb-widget');
      await conflictTile.locator('.sb-frame-controls').click();
      const conflictPanel = page.locator(`[data-sb-panel="${conflictKey}"]`);
      await expect(conflictPanel).toBeVisible();
      await conflictPanel.getByLabel('Section title').fill(`Conflict ${stamp}`);
      await expect(page.locator('[data-sb-dirty="1"]'), 'the edit changed the layout').toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-sb-status="conflict"]')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Publish changes' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'changed elsewhere' })).toBeVisible({ timeout: 5_000 });
      await page.getByRole('button', { name: 'Reload', exact: true }).click();
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-status="idle"][data-sb-dirty="0"]')).toBeVisible();

      // B4: the keyboard path — a tile's header is a focusable button (Enter
      // selects and focus moves into the panel); Tab never lands inside a
      // tile's body (inert); Escape cancels the discard confirm.
      const kbTile = page.locator('[data-sb-widget="staff"]');
      await kbTile.locator('.sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      const kbPanel = page.locator('[data-sb-panel="staff"]');
      await expect(kbPanel).toBeVisible();
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-sb-panel]'))).toBe(true);
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const inBody = await page.evaluate(() => !!document.activeElement?.closest('.sb-widget-body'));
        expect(inBody, `Tab #${i + 1} must not land inside a tile body`).toBe(false);
      }
      // Escape cancels the discard confirm (a CONTENT field is what the guard watches).
      await page.locator('[data-sb-widget="hero"] .sb-frame-controls').click();
      const kbHero = page.locator('[data-sb-panel="hero"]');
      await kbHero.getByLabel('Headline').fill(`Kb ${stamp}`);
      await page.locator('[data-sb-widget="news"] .sb-frame-controls').click();
      const kbDiscard = page.getByRole('dialog', { name: 'Discard changes?' });
      await expect(kbDiscard).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(kbDiscard).toBeHidden();
      await expect(kbHero).toBeVisible();
      // Leave the hero panel: Discard in the confirm (the typed headline is not saved) → the news panel opens.
      await page.locator('[data-sb-widget="news"] .sb-frame-controls').click();
      await expect(kbDiscard).toBeVisible();
      await kbDiscard.getByRole('button', { name: 'Discard', exact: true }).click();
      await expect(page.locator('[data-sb-panel="news"]')).toBeVisible();

      // P3-D: remove a tile → an Undo toast (no confirm dialog) → Undo restores it.
      const before = await page.locator('[data-sb-instance]').count();
      const removable = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      const removedKey = await removable.getAttribute('data-sb-widget');
      await removable.getByRole('button', { name: /^Remove / }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before - 1);
      const toast = page.getByRole('alert').filter({ hasText: 'Section removed' });
      await expect(toast).toBeVisible();
      // H6: an edit made while the toast is up (rename another section), THEN
      // the toast's Undo — the REMOVED section comes back (the toast undoes
      // the removal, not "whatever happened last").
      const other = page.locator('[data-sb-widget]:not([data-sb-widget="hero"])').first();
      const otherKey = await other.getAttribute('data-sb-widget');
      await other.locator('.sb-frame-controls').click();
      await page.locator(`[data-sb-panel="${otherKey}"]`).getByLabel('Section title').fill(`Meanwhile ${stamp}`);
      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before);
      await expect(page.locator(`[data-sb-widget="${removedKey}"]`)).toBeVisible();
      // Remove again (for real), then add it back from the picker — tiles preview the club's data.
      await page.locator(`[data-sb-widget="${removedKey}"]`).getByRole('button', { name: /^Remove / }).click();
      await expect(page.locator('[data-sb-instance]')).toHaveCount(before - 1);
      await awaitDraftSaved(page);
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
      await awaitDraftSaved(page);
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
      // B6: the visibility control writes the instance's audience (members → public again below).
      await panel.getByLabel('Who sees it').selectOption('members');
      await awaitDraftSaved(page);
      const vis = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; visibility: string }[] } };
      expect(vis.layout.widgets.find(w => w.key === targetKey)?.visibility).toBe('members');
      await panel.getByLabel('Who sees it').selectOption('public');
      await expect(target.locator('.sb-frame-controls')).toContainText(`Our ${targetKey} ${stamp}`);
      await awaitDraftSaved(page);
      // The hero's CONTENT goes through set_hero (the console's own write) and the canvas re-reads it.
      await page.locator('[data-sb-widget="hero"] .sb-frame-controls').click();
      const heroPanel = page.locator('[data-sb-panel="hero"]');
      await expect(heroPanel).toBeVisible();
      await heroPanel.getByLabel('Headline').fill(`Hello ${stamp}`);
      // H7: a tile switch while content is typed and unsaved asks first; Cancel keeps the panel and the words.
      await page.locator('[data-sb-widget="staff"] .sb-frame-controls').click();
      const discard = page.getByText('Discard changes?', { exact: true }).locator('..').locator('..');
      await expect(discard).toBeVisible();
      await discard.getByRole('button', { name: 'Cancel' }).click();
      await expect(discard).toBeHidden();
      await expect(heroPanel.getByLabel('Headline')).toHaveValue(`Hello ${stamp}`);
      await heroPanel.getByRole('button', { name: 'Save content' }).click();
      await expect(page.locator('[data-sb-widget="hero"]')).toContainText(`Hello ${stamp}`, { timeout: 20_000 });
      // The console's GET sees the same draft content (one write, two surfaces).
      const draftView = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { hero_config: { headline?: string } } };
      expect(draftView.site.hero_config.headline).toBe(`Hello ${stamp}`);
      // P10-C parity: the welcome photo and the contact address / socials are
      // on the panel now (the console forms are gone) — saved through the same actions.
      await heroPanel.locator('input[type="file"]').setInputFiles('e2e/fixtures/photo.png');
      await expect(heroPanel.locator('[data-sb-image-preview]')).toBeVisible({ timeout: 20_000 });
      await heroPanel.getByLabel('Describe the photo', { exact: true }).fill(`Clubhouse ${stamp}`);
      await heroPanel.getByRole('button', { name: 'Save content' }).click();
      await expect(page.locator('[data-sb-widget="hero"] img')).toBeVisible({ timeout: 20_000 });
      const heroSaved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { hero_config: { headline?: string; imagePath?: string; imageAlt?: string } } };
      expect(heroSaved.site.hero_config.headline).toBe(`Hello ${stamp}`);
      expect(heroSaved.site.hero_config.imagePath).toMatch(/^org-media\/[0-9a-f-]{36}\/[a-z0-9-]+\.png$/);
      expect(heroSaved.site.hero_config.imageAlt).toBe(`Clubhouse ${stamp}`);
      await page.locator('[data-sb-widget="contact"] .sb-frame-controls').click();
      const contactPanel = page.locator('[data-sb-panel="contact"]');
      await expect(contactPanel).toBeVisible();
      await contactPanel.getByLabel('Email', { exact: true }).fill(`hello-${stamp}@example.com`);
      await contactPanel.getByLabel('Address', { exact: true }).fill(`1 Rink Road\nToronto ON`);
      await contactPanel.getByLabel('Instagram', { exact: true }).fill('https://instagram.com/qa-league');
      await contactPanel.getByRole('button', { name: 'Save content' }).click();
      await expect(page.locator('[data-sb-widget="contact"]')).toContainText('1 Rink Road', { timeout: 20_000 });
      const contactSaved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { contact_config: { email?: string; address?: string[]; social?: { instagram?: string } } } };
      expect(contactSaved.site.contact_config.email).toBe(`hello-${stamp}@example.com`);
      expect(contactSaved.site.contact_config.address).toEqual(['1 Rink Road', 'Toronto ON']);
      expect(contactSaved.site.contact_config.social?.instagram).toBe('https://instagram.com/qa-league');

      // Phase 6 (P6-B): the picker's "Your own content" — add a Text section,
      // its panel opens at once (a content tile is empty until written); type
      // a paragraph (one undo step, the tile updates live, autosaved); then an
      // Embed from a pasted link, then an Image uploaded through the panel.
      await page.getByRole('button', { name: 'Add section' }).click();
      await page.locator('[data-sb-picker-tile="text"]').getByRole('button', { name: 'Add' }).click();
      const textPanel = page.locator('[data-sb-panel="text"]');
      await expect(textPanel).toBeVisible();
      await textPanel.getByLabel('Section title').fill(`Story ${stamp}`);
      await textPanel.getByRole('button', { name: '+ Paragraph' }).click();
      await textPanel.getByLabel('Paragraph 1', { exact: true }).fill(`Typed paragraph ${stamp}`);
      await expect(page.locator('[data-sb-widget="text"]').first()).toContainText(`Typed paragraph ${stamp}`);
      await awaitDraftSaved(page);
      // One undo step for the whole paragraph: Undo clears the text, Redo brings it back.
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(textPanel.getByLabel('Paragraph 1', { exact: true })).toHaveValue('');
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      await expect(textPanel.getByLabel('Paragraph 1', { exact: true })).toHaveValue(`Typed paragraph ${stamp}`);
      // Redo lands on the very layout the server holds — nothing to save, the chip stays clean.
      await expect(page.locator('[data-sb-dirty="0"]')).toBeVisible();

      await page.getByRole('button', { name: 'Add section' }).click();
      await page.locator('[data-sb-picker-tile="embed"]').getByRole('button', { name: 'Add' }).click();
      const embedPanel = page.locator('[data-sb-panel="embed"]');
      await expect(embedPanel).toBeVisible();
      await embedPanel.getByLabel('Video or map link').fill('https://vimeo.com/76979871');
      await expect(embedPanel.locator('[data-sb-embed="vimeo"]')).toContainText('Vimeo video');
      await expect(page.locator('[data-sb-widget="embed"] iframe').first()).toHaveAttribute('src', 'https://player.vimeo.com/video/76979871');
      await awaitDraftSaved(page);
      await embedPanel.getByLabel('Video or map link').fill('https://example.com/not-a-video');
      await expect(embedPanel.getByText('Not a link we can show')).toBeVisible();

      await page.getByRole('button', { name: 'Add section' }).click();
      await page.locator('[data-sb-picker-tile="image"]').getByRole('button', { name: 'Add' }).click();
      const imagePanel = page.locator('[data-sb-panel="image"]');
      await expect(imagePanel).toBeVisible();
      await imagePanel.locator('input[type="file"]').setInputFiles('e2e/fixtures/photo.png');
      await expect(imagePanel.locator('[data-sb-image-preview]')).toBeVisible({ timeout: 20_000 });
      await imagePanel.getByLabel('Describe the photo').fill(`Photo alt ${stamp}`);
      await imagePanel.getByLabel('Caption').fill(`Photo caption ${stamp}`);
      await expect(page.locator('[data-sb-widget="image"] img').first()).toBeVisible();
      await awaitDraftSaved(page);

      // Phase 6 (P6-A): the same tiles through the draft API — a cross-site
      // image path is refused; an embed is a STRUCTURE, never a URL.
      const before6 = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as {
        layout: { version: 1; cols: 12; widgets: { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: unknown; visibility: string }[] };
        draft: { rev: number };
      };
      const bottom = Math.max(...before6.layout.widgets.map(w => w.y + w.h));
      const contentTiles = [
        { id: 'w_00000000000006a1', key: 'text', x: 0, y: bottom, w: 6, h: 3, cv: 1, visibility: 'public', config: { title: `Notes ${stamp}`, blocks: [{ type: 'paragraph', text: `Welcome paragraph ${stamp}` }] } },
        { id: 'w_00000000000006a2', key: 'embed', x: 6, y: bottom, w: 6, h: 3, cv: 1, visibility: 'public', config: { embed: { provider: 'youtube', id: 'dQw4w9WgXcQ' } } },
        // An image with no photo yet: staff see the tile, visitors never do.
        { id: 'w_00000000000006a3', key: 'image', x: 0, y: bottom + 3, w: 6, h: 4, cv: 1, visibility: 'public', config: {} },
      ];
      const foreign = { ...contentTiles[2], config: { path: 'org-media/00000000-0000-4000-8000-000000000000/x.jpg', alt: 'x' } };
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
        data: { layout: { ...before6.layout, widgets: [...before6.layout.widgets, contentTiles[0], contentTiles[1], foreign] }, baseRev: before6.draft.rev },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);
      const urlEmbed = { ...contentTiles[1], config: { embed: 'https://youtu.be/dQw4w9WgXcQ' } };
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
        data: { layout: { ...before6.layout, widgets: [...before6.layout.widgets, contentTiles[0], urlEmbed] }, baseRev: before6.draft.rev },
      });
      expect(res.status(), await readErrorBody(res)).toBe(400);
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
        data: { layout: { ...before6.layout, widgets: [...before6.layout.widgets, ...contentTiles] }, baseRev: before6.draft.rev },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);

      // Phase 7 (P7-A): design tokens over the template + a heading face. Set
      // through the console's own action (the theme panel arrives in P7-B);
      // the editor canvas wears the theme on the next load.
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, {
        data: { action: 'set_theme', accent: '#1d4ed8', accentStrong: null, surface: 'plain', typeface: 'oswald', header: 'band', hero: 'bleed', density: 'compact' },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const themed = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { theme_token_set: Record<string, unknown>; template_id: string } };
      expect(themed.site.theme_token_set).toMatchObject({ accent: '#1d4ed8', typeface: 'oswald', header: 'band', hero: 'bleed', density: 'compact' });
      expect(themed.site.template_id).toBe('classic');
      await page.reload();
      await expect(canvasEl).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-canvas][data-typeface="oswald"][data-heading-font]')).toBeVisible();
      expect(await canvasEl.evaluate(el => getComputedStyle(el).getPropertyValue('--org-accent').trim())).toBe('#1d4ed8');
      // The hero tile took the bleed variant from the token, not the template.
      await expect(page.locator('[data-sb-widget="hero"] h1')).toHaveClass(/uppercase/);

      // Phase 7 (P7-B): the theme panel. Every change previews on the canvas
      // before anything is written; a too-light accent is refused with the
      // contrast readout; Save goes through set_theme and the canvas
      // re-dresses from the server's draft.
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      const themePanel = page.locator('[data-sb-theme-panel]');
      await expect(themePanel).toBeVisible();
      await themePanel.getByLabel('Accent colour', { exact: true }).fill('#ffff00');
      await expect(themePanel.locator('[data-sb-accent-ok="0"]')).toContainText('too light');
      await expect(themePanel.getByRole('button', { name: 'Save theme' })).toBeDisabled();
      await themePanel.getByLabel('Accent colour', { exact: true }).fill('#0f766e');
      // H7: a stray tile click while the theme draft differs asks first; Cancel keeps the panel and the accent.
      await page.locator('[data-sb-widget="staff"] .sb-frame-controls').click();
      const discardTheme = page.getByText('Discard changes?', { exact: true }).locator('..').locator('..');
      await expect(discardTheme).toBeVisible();
      await discardTheme.getByRole('button', { name: 'Cancel' }).click();
      await expect(themePanel).toBeVisible();
      await expect(themePanel.getByLabel('Accent colour', { exact: true })).toHaveValue('#0f766e');
      await expect(themePanel.locator('[data-sb-accent-ok="1"]')).toContainText('readable');
      // Live preview: the canvas already wears the unsaved accent…
      expect(await canvasEl.evaluate(el => getComputedStyle(el).getPropertyValue('--org-accent').trim())).toBe('#0f766e');
      // …and the face, shown in its own face on the panel.
      await themePanel.locator('[data-sb-typeface="lora"]').click();
      await expect(page.locator('[data-sb-canvas][data-typeface="lora"]')).toBeVisible();
      await themePanel.getByLabel('Header', { exact: true }).selectOption('bar');
      // Nothing written yet: the console still holds oswald + band.
      const unsaved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { theme_token_set: Record<string, unknown> } };
      expect(unsaved.site.theme_token_set).toMatchObject({ accent: '#1d4ed8', typeface: 'oswald', header: 'band' });
      // B6: the three design selects the panel offers (density / teams / surface).
      await themePanel.getByLabel('Spacing', { exact: true }).selectOption('compact');
      await themePanel.getByLabel('Teams', { exact: true }).selectOption('tiles');
      await themePanel.getByLabel('Background', { exact: true }).selectOption('tinted');
      await themePanel.getByRole('button', { name: 'Save theme' }).click();
      await expect
        .poll(async () => {
          const c = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { site: { theme_token_set: Record<string, unknown> } };
          return [c.site.theme_token_set.density, c.site.theme_token_set.teams, c.site.theme_token_set.surface].join(',');
        }, { timeout: 15_000 })
        .toBe('compact,tiles,tinted');
      await expect(themePanel).toBeHidden({ timeout: 20_000 });
      const savedTheme = (await (await ownerApi.get(`/api/leagues/${leagueId}/site`)).json()) as { site: { theme_token_set: Record<string, unknown> } };
      expect(savedTheme.site.theme_token_set).toMatchObject({ accent: '#0f766e', typeface: 'lora', header: 'bar', hero: 'bleed', density: 'compact' });
      expect(savedTheme.site.theme_token_set.accentStrong).toBeUndefined();
      // Every required step is done now (colours by this save; the photo and the
      // welcome by the hero panel; arrange by the drag; publish above) — the rail
      // is derived, so it is simply gone.
      await expect(rail).toHaveCount(0);
      // The canvas wears the saved theme (and a later layout autosave still carries the bumped rev).
      await expect(page.locator('[data-sb-canvas][data-typeface="lora"]')).toBeVisible();
      expect(await canvasEl.evaluate(el => getComputedStyle(el).getPropertyValue('--org-accent').trim())).toBe('#0f766e');
      await page.locator('[data-sb-widget="staff"] .sb-frame-controls').click();
      await page.locator('[data-sb-panel="staff"]').getByLabel('Section title').fill(`Our staff again ${stamp}`);
      await awaitDraftSaved(page);

      // Sep 11 2026: the panel's Size control — a named size is a preset over
      // `w` (one undo step, autosaved); the layout re-flows around it.
      const sizeGroup = page.locator('[data-sb-panel="staff"]').getByRole('radiogroup', { name: /^Size of / });
      await expect(sizeGroup).toBeVisible();
      await sizeGroup.getByRole('radio', { name: 'Medium' }).click();
      await awaitDraftSaved(page);
      await expect(sizeGroup.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true');
      const sized = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; w: number }[] } };
      expect(sized.layout.widgets.find(w => w.key === 'staff')!.w).toBe(6);
      await sizeGroup.getByRole('radio', { name: 'Wide' }).click();
      await awaitDraftSaved(page);

      // The phone: the SAME editor as a list (Sep 11 2026) — the header's doors, the sections, no overflow.
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.locator('[data-sb-sections]')).toBeVisible();
      await expect(page.locator('[data-sb-canvas]')).toBeHidden();
      await expect(page.locator('[data-sb-section]')).toHaveCount(await page.locator('[data-sb-instance]').count());
      await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish changes' })).toBeVisible();
      await expect(page.getByRole('link', { name: '← Console' })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: 1280, height: 900 });

      // The public page is untouched by draft edits — asserted by what it must
      // NOT carry yet (B6: a byte-compare of two ISR documents failed on any
      // relative date or background revalidation between the fetches).
      const publicAfter = await (await anon.request.get(`/org/${subdomain}`)).text();
      expect(publicAfter).toContain(`QA Editor League ${stamp}`);
      expect(publicAfter).not.toContain(`Our staff ${stamp}`);
      expect(publicAfter).not.toContain(`Hello ${stamp}`);
      expect(publicAfter).not.toContain(`Story ${stamp}`);
      expect(publicBefore).toContain(`QA Editor League ${stamp}`);

      // P3-C closes the loop: publish → the public grid renders the moved layout
      // in reading order (the DOM order of the tiles follows the coordinates).
      res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'publish', label: 'Arranged' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const finalLayout = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { id: string; key: string; y: number; x: number }[] } };
      // Phase 9: tiles carry their INSTANCE id publicly (`data-widget-id`), so
      // the order is compared by id — keys can repeat (two standings). Module
      // tiles only: the content tiles sit at the bottom and an empty one (the
      // photo-less image) is dropped, after which compaction may lift a
      // neighbour — the module sections' relative order is the contract.
      const CONTENT_KEYS = ['text', 'image', 'embed'];
      const moduleIds = new Set(finalLayout.layout.widgets.filter(w => !CONTENT_KEYS.includes(w.key)).map(w => w.id));
      const publishedOrder = [...finalLayout.layout.widgets]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(w => w.id)
        .filter(id => moduleIds.has(id));
      const tileIds = (html: string) => [...html.matchAll(/data-widget-id="([^"]+)"/g)].map(m => m[1]).filter(id => moduleIds.has(id));
      let publicHtml = '';
      await expect
        .poll(async () => {
          publicHtml = await (await anon.request.get(`/org/${subdomain}`)).text();
          const tiles = tileIds(publicHtml);
          // Empty widgets never render publicly — compare the order of the ones that do.
          const expected = publishedOrder.filter(id => tiles.includes(id));
          return JSON.stringify(tiles) === JSON.stringify(expected) && tiles.length > 0;
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      expect(publicHtml).toContain('data-sb-grid');
      // Phase 5: the instance title and the hero content both reached the public page.
      expect(publicHtml).toContain(`Hello ${stamp}`);
      // Phase 6: the text widget (its title is the heading, its paragraph the
      // body) and the embed (the frame src rebuilt on the privacy host) are
      // live; the photo-less image tile is not there at all.
      expect(publicHtml).toContain(`Notes ${stamp}`);
      expect(publicHtml).toContain(`Welcome paragraph ${stamp}`);
      expect(publicHtml).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
      // P6-B: the typed story, the pasted Vimeo frame, the uploaded photo with
      // its alt + caption; the photo-less image tile from the API is the one
      // image tile that is NOT there.
      expect(publicHtml).toContain(`Story ${stamp}`);
      expect(publicHtml).toContain(`Typed paragraph ${stamp}`);
      expect(publicHtml).toContain('https://player.vimeo.com/video/76979871');
      expect(publicHtml).toContain(`Photo alt ${stamp}`);
      expect(publicHtml).toContain(`Photo caption ${stamp}`);
      expect(publicHtml.match(/data-widget="image"/g)?.length ?? 0).toBe(1);
      // Phase 7: the theme reached the public shell — accent vars, the band
      // header (from the TOKEN; the template is still classic), the heading
      // face loaded only here (its @font-face + preload), the bleed hero.
      // (P7-B saved the panel's version over the API's: teal, Editorial face, bar header, bleed hero kept.)
      expect(publicHtml).toContain('--org-accent:#0f766e');
      expect(publicHtml).toContain('data-template="classic"');
      expect(publicHtml).not.toContain('background-color:var(--org-accent-strong)');
      expect(publicHtml).toContain('data-typeface="lora"');
      expect(publicHtml).toContain('data-heading-font');
      expect(publicHtml).toContain("font-family:'EA Lora'");
      expect(publicHtml).toContain('/fonts/lora-700.woff2');
      expect(publicHtml).toMatch(/<link[^>]*rel="preload"[^>]*\/fonts\/lora-700\.woff2/);
      expect(publicHtml).not.toContain('/fonts/oswald-600.woff2');
      expect(publicHtml).toContain('sm:py-20');
      expect(publicHtml).toContain(`Our staff again ${stamp}`);
      const fontRes = await anon.request.get('/fonts/lora-700.woff2');
      expect(fontRes.status()).toBe(200);

      // Phase 8: (a) the publish recorded its metrics on the revision;
      // (b) with no draft left, the editor's canvas shows the PUBLISHED
      // arrangement (not the projection); (c) a console content edit after
      // the publish materialises a draft that INHERITS the published layout,
      // so publishing it keeps the arrangement.
      const list = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/revisions`)).json()) as {
        draft: unknown;
        revisions: { isPublished: boolean; stats: { widgetCount: number | null; widgetsTouched: number; added: string[]; firstPublish: boolean; secondsSinceDraft: number | null; secondsSinceSiteCreated: number | null } | null }[];
      };
      expect(list.draft).toBeNull();
      const published = list.revisions.find(r => r.isPublished)!;
      expect(published.stats).not.toBeNull();
      expect(published.stats!.widgetCount).toBe(finalLayout.layout.widgets.length);
      expect(published.stats!.widgetsTouched).toBeGreaterThan(0);
      expect(published.stats!.added).toEqual(expect.arrayContaining(['text', 'embed', 'image']));
      expect(published.stats!.secondsSinceDraft).toBeGreaterThanOrEqual(0);
      expect(published.stats!.secondsSinceSiteCreated).toBeGreaterThanOrEqual(0);
      const noDraftCanvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { draft: unknown; layout: { widgets: { id: string; x: number; y: number }[] } };
      expect(noDraftCanvas.draft).toBeNull();
      expect([...noDraftCanvas.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.id)).toEqual(
        [...finalLayout.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.id)
      );
      res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_hero', headline: `After publish ${stamp}` } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      // Phase 10: title the standings instance — the in-app bubble and its window take the name.
      const forTitle = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; config: Record<string, unknown> }[] }; draft: { rev: number } | null };
      res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, {
        data: {
          layout: { ...forTitle.layout, widgets: forTitle.layout.widgets.map(w => (w.key === 'standings' ? { ...w, config: { ...w.config, title: `Table ${stamp}` } } : w)) },
          ...(forTitle.draft ? { baseRev: forTitle.draft.rev } : {}),
        },
      });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      const inherited = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { draft: unknown; layout: { widgets: { id: string; x: number; y: number }[] } };
      expect(inherited.draft).not.toBeNull();
      expect([...inherited.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.id)).toEqual(
        [...noDraftCanvas.layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.id)
      );
      res = await ownerApi.post(`/api/leagues/${leagueId}/site/revisions`, { data: { action: 'publish' } });
      expect(res.status(), await readErrorBody(res)).toBe(200);
      await expect
        .poll(async () => {
          const html = await (await anon.request.get(`/org/${subdomain}`)).text();
          const tiles = tileIds(html);
          const expected = publishedOrder.filter(id => tiles.includes(id));
          return html.includes(`After publish ${stamp}`) && JSON.stringify(tiles) === JSON.stringify(expected);
        }, { timeout: 30_000, intervals: [1000, 2000, 3000] })
        .toBe(true);
      // The policy that lets that frame load — on whichever CSP header the build sends.
      const publicRes = await anon.request.get(`/org/${subdomain}`);
      const csp = publicRes.headers()['content-security-policy'] ?? publicRes.headers()['content-security-policy-report-only'] ?? '';
      expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.openstreetmap.org');

      // Phase 10: one composition, two surfaces — the in-app league page follows
      // the layout's reading order (module bubbles, via the bubble aliases) and
      // the instance title names the bubble and its window. At 1280 and 375.
      // The module keys with an APP surface, by their bubble key (the catalog's
      // aliases); web-only widgets (hero, staff, courses, contact…) have no bubble.
      const APP_BUBBLE: Record<string, string> = { members: 'members', standings: 'standings', schedule: 'events', news: 'news', venues: 'courses', gallery: 'photos', affiliations: 'affiliations' };
      const finalCanvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { widgets: { key: string; x: number; y: number }[] } };
      const layoutBubbles = [...finalCanvas.layout.widgets]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map(w => APP_BUBBLE[w.key])
        .filter((k): k is string => !!k);
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/league/${leagueId}`);
        const grid = page.locator('[data-org-glance]');
        await expect(grid).toBeVisible({ timeout: 30_000 });
        await expect(grid.locator('[data-org-bubble="standings"]')).toContainText(`Table ${stamp}`);
        const domBubbles = await grid.locator('[data-org-bubble]').evaluateAll(els => els.map(e => e.getAttribute('data-org-bubble') ?? ''));
        const expectedOrder = layoutBubbles.filter(k => domBubbles.includes(k));
        expect(domBubbles.filter(k => expectedOrder.includes(k))).toEqual(expectedOrder);
        // P10-B: the content tiles render in-app where the manager placed them —
        // the typed story and the API's welcome paragraph, the two embeds on their
        // provider hosts, the uploaded photo; no horizontal overflow.
        await expect(grid.locator('[data-org-tile-kind="text"]').filter({ hasText: `Typed paragraph ${stamp}` })).toBeVisible();
        await expect(grid.locator('[data-org-tile-kind="text"]').filter({ hasText: `Welcome paragraph ${stamp}` })).toBeVisible();
        const frameSrcs = await grid.locator('[data-org-tile-kind="embed"] iframe').evaluateAll(els => els.map(e => e.getAttribute('src') ?? ''));
        expect(frameSrcs.some(u => u.startsWith('https://player.vimeo.com/video/76979871'))).toBe(true);
        expect(frameSrcs.some(u => u.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'))).toBe(true);
        await expect(grid.locator('[data-org-tile-kind="image"] img').first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      }
      // (The window's title is the same label — LargerWindow reads it — and a
      // zero-count face does not open, so the bubble text above is the check.)

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
