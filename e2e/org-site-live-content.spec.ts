import { test, expect } from '@playwright/test';
import { createQaOrg } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { settleBody } from './helpers/isr';

// Site Builder program 3, H3 — live content: what is typed in a section's
// Content fieldset reaches the canvas as it is typed (before Save), the
// contact card's fields take the manager's order, a discard clears the
// preview, and only "Save content" writes.

test('org site live content: a typed email shows on the canvas before Save; the field order saves and publishes; a discard clears the preview', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Live Content ${stamp}`, sport_key: 'soccer', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');
    // A phone on the card already, so the order has two fields to swap.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_contact', phone: '555 0100' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The action takes the known keys only.
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_contact', phone: '555 0100', order: ['nope'] } });
    expect(res.status()).toBe(400);

    const email = `live-${stamp}@example.com`;
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      // Sample data would fill the card — switch it off so the real card shows.
      const sample = page.locator('[data-sb-sample]');
      if ((await sample.getAttribute('aria-pressed')) === 'true') await sample.click();
      const tile = page.locator('[data-sb-instance][data-sb-widget="contact"]');
      await expect(tile).toContainText('555 0100');
      await expect(tile).not.toContainText(email);

      await tile.locator('.sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      const panel = page.locator('[data-sb-panel="contact"]');
      await expect(panel).toBeVisible();
      // Type: the canvas shows the email at once — nothing saved yet.
      await panel.getByLabel('Email', { exact: true }).fill(email);
      await expect(tile).toContainText(email);
      const unsaved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { site: { contact_config: Record<string, unknown> } };
      expect(unsaved.site.contact_config.email).toBeUndefined();
      // Phone above Email: today's order is address, hours, directions, email,
      // phone… — one "Move Phone up" puts it before Email, live on the card.
      const order = panel.locator('[data-sb-reorder]');
      await order.locator('[data-sb-reorder-up][aria-label="Move Phone up"]').click();
      const fields = await tile.locator('[data-contact-field]').evaluateAll(els => els.map(e => e.getAttribute('data-contact-field')));
      expect(fields.indexOf('phone')).toBeLessThan(fields.indexOf('email'));

      // Discard: close the panel without saving → the preview is gone, the card is as saved.
      await page.locator('[data-sb-instance][data-sb-widget="hero"] .sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      // The dirty guard asks first — discard.
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: /discard/i }));
      if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /discard/i }).click();
      await expect(page.locator('[data-sb-panel="hero"]')).toBeVisible();
      await expect(tile).not.toContainText(email);

      // Again, and Save this time.
      await tile.locator('.sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await panel.getByLabel('Email', { exact: true }).fill(email);
      await panel.locator('[data-sb-reorder] [data-sb-reorder-up][aria-label="Move Phone up"]').click();
      await page.getByRole('button', { name: 'Save content' }).click();
      await expect(page.getByRole('button', { name: 'Save content' })).toBeDisabled({ timeout: 20_000 });
      const saved = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { site: { contact_config: { email?: string; order?: string[] } } };
      expect(saved.site.contact_config.email).toBe(email);
      expect(saved.site.contact_config.order?.indexOf('phone')).toBeLessThan(saved.site.contact_config.order!.indexOf('email'));
    } finally {
      await ctx.close();
    }

    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, email, true);
      expect(html.indexOf('data-contact-field="phone"')).toBeLessThan(html.indexOf('data-contact-field="email"'));
    } finally {
      await anon.close();
    }
  } finally {
    await admin.from('leagues').delete().eq('id', leagueId);
  }
});
