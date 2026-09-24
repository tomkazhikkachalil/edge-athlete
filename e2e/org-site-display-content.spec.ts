import fs from 'fs';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite, revisionsSupported } from './helpers/org-site';
import { awaitDraftSaved, settleBody } from './helpers/isr';

// Site Builder program 3, D1b — the content widgets' display axes: the
// hero's shape and alignment, a text block on a card, an image cropped
// square with its link switched off, a form in two columns with the
// manager's own button label, a contact card as one line without socials.
// Set through the draft PUT (the generated schema validates them) and one
// panel interaction; rendered on the canvas and on the published page.

type Widget = { id: string; key: string; x: number; y: number; w: number; h: number; cv: number; config: Record<string, unknown>; visibility: string };

test('org site display (content widgets): hero, text, image, form and contact axes reach the canvas and the published page', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = loadQaUser('user-b.json');
  const admin = adminClient();
  await resetRateBucket(admin, 'org-site', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const stamp = Date.now();
  const league = await createQaOrg(admin, 'league', { name: `QA Display Content ${stamp}`, sport_key: 'soccer', owner_profile_id: owner.id });
  const leagueId = league.id;
  await admin.from('memberships').insert([{ org_id: leagueId, profile_id: owner.id, role: 'owner' }]);

  try {
    let res = await ownerApi.post(`/api/leagues/${leagueId}/site`);
    expect(res.status(), await readErrorBody(res)).toBe(200);
    const subdomain = (await res.json()).site.subdomain as string;
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'publish' } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    test.skip(!(await revisionsSupported(ownerApi, 'league', leagueId)), 'org_site_revisions missing — run migration 180');

    // Real contact content with a social link (the display axis hides it).
    res = await ownerApi.patch(`/api/leagues/${leagueId}/site`, { data: { action: 'set_contact', email: `hello-${stamp}@example.com`, social: { instagram: 'https://www.instagram.com/qa-display' } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // A photo for the image widget.
    const upload = await ownerApi.post(`/api/leagues/${leagueId}/site/assets`, { multipart: { image: { name: 'photo.png', mimeType: 'image/png', buffer: fs.readFileSync('e2e/fixtures/photo.png') } } });
    expect(upload.status(), await readErrorBody(upload)).toBe(200);
    const photoPath = (await upload.json()).path as string;

    const canvas = (await (await ownerApi.get(`/api/leagues/${leagueId}/site/canvas`)).json()) as { layout: { version: number; cols: number; widgets: Widget[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const widgets = canvas.layout.widgets.map(w =>
      w.key === 'hero'
        ? { ...w, config: { ...w.config, display: { variant: 'bleed', align: 'center' } } }
        : w.key === 'contact'
          ? { ...w, config: { ...w.config, display: { variant: 'inline', showSocials: false } } }
          : w
    );
    widgets.push(
      { id: 'w_d1b0000000000001', key: 'text', x: 0, y: bottom, w: 12, h: 3, cv: 1, visibility: 'public', config: { blocks: [{ type: 'paragraph', text: `Words on a card ${stamp}.` }], display: { variant: 'card', align: 'center' } } },
      { id: 'w_d1b0000000000002', key: 'image', x: 0, y: bottom + 3, w: 6, h: 4, cv: 1, visibility: 'public', config: { path: photoPath, alt: 'A photo', href: 'https://example.com/never', width: 640, height: 480, display: { variant: 'framed', aspect: 'square', click: 'none' } } },
      { id: 'w_d1b0000000000003', key: 'contact_form', x: 6, y: bottom + 3, w: 6, h: 7, cv: 1, visibility: 'public', config: { display: { variant: 'columns', button: 'Say hello' } } }
    );
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets } } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
    // The generated schema refuses what the panel could not offer.
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: widgets.map(w => (w.key === 'image' ? { ...w, config: { ...w.config, display: { aspect: 'round' } } } : w)) } } });
    expect(res.status()).toBe(400);
    res = await ownerApi.put(`/api/leagues/${leagueId}/site/draft`, { data: { layout: { ...canvas.layout, widgets: widgets.map(w => (w.key === 'contact_form' ? { ...w, config: { display: { button: 'x'.repeat(25) } } } : w)) } } });
    expect(res.status()).toBe(400);

    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      // The canvas renders the axes.
      await expect(page.locator('[data-sb-widget="hero"] [data-hero-shape="bleed"]')).toBeVisible();
      await expect(page.locator('[data-sb-widget="text"] [data-variant="card"]')).toContainText(`Words on a card ${stamp}.`);
      await expect(page.locator('[data-sb-widget="image"] figure[data-aspect="square"]')).toBeVisible();
      await expect(page.locator('[data-sb-widget="image"] figure a')).toHaveCount(0);
      await expect(page.locator('[data-sb-widget="contact_form"] form[data-variant="columns"] button')).toHaveText('Say hello');
      await expect(page.locator('[data-sb-widget="contact"] [data-variant="inline"]')).toBeVisible();
      await expect(page.locator('[data-sb-widget="contact"] a[href*="instagram.com"]')).toHaveCount(0);

      // The panel's text field — typed, autosaved, on the canvas at once.
      await page.locator('[data-sb-instance][data-sb-widget="contact_form"] .sb-frame-controls').focus();
      await page.keyboard.press('Enter');
      const panel = page.locator('[data-sb-panel="contact_form"]');
      await expect(panel).toBeVisible();
      const button = panel.locator('[data-sb-display="button"]');
      await expect(button).toHaveValue('Say hello');
      await button.fill('Ping us');
      await expect(page.locator('[data-sb-widget="contact_form"] form button')).toHaveText('Ping us');
      await awaitDraftSaved(page);
    } finally {
      await ctx.close();
    }

    await publishSite(ownerApi, 'league', leagueId);
    const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
    try {
      const html = await settleBody(anon.request, `/org/${subdomain}`, 'Ping us', true);
      expect(html).toContain('data-hero-shape="bleed"');
      expect(html).toMatch(/data-hero-shape="bleed"[^>]*class="[^"]*text-center/);
      expect(html).toContain(`Words on a card ${stamp}.`);
      expect(html).toContain('data-variant="card"');
      expect(html).toContain('data-aspect="square"');
      expect(html).not.toContain('https://example.com/never');
      expect(html).toContain('data-variant="columns"');
      // The contact SECTION has no social link (the page's JSON-LD `sameAs` still names it — that is the org's identity, not the card).
      const contactAt = html.indexOf('data-variant="inline"');
      expect(contactAt).toBeGreaterThan(-1);
      expect(html.slice(contactAt, html.indexOf('</section>', contactAt))).not.toContain('instagram.com');
      expect(html).toContain(`hello-${stamp}@example.com`);
    } finally {
      await anon.close();
    }
  } finally {
    await deleteQaOrgs(admin, [leagueId]);
  }
});
