import path from 'path';
import { test, expect } from '@playwright/test';
import { createQaOrg, deleteQaOrgs } from './helpers/org';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { publishSite } from './helpers/org-site';
import { settleBody, settleStatus } from './helpers/isr';

// Sports-team website program, H1 (Sep 27 2026): one home for managers —
// the documents, the logo, the gallery's member-photo picks and "Subpages &
// navigation" are all in the site editor now. One person, one place: write a
// document into the Documents section, change the logo and a header label in
// Settings, switch a subpage off (the editor reloads from the re-laid draft),
// publish — and the public site shows every change.

async function setUp(stamp: number) {
  const admin = adminClient();
  const owner = loadQaUser('user-b.json');
  await resetRateBucket(admin, 'org-site', owner.id);
  await resetRateBucket(admin, 'org-site-draft', owner.id);
  const ownerApi = await apiAs('state-b.json');
  const league = await createQaOrg(admin, 'league', { name: `QA One Home League ${stamp}`, sport_key: 'ice_hockey', owner_profile_id: owner.id });
  await admin.from('memberships').insert([{ org_id: league.id, profile_id: owner.id, role: 'owner' }]);
  let res = await ownerApi.post(`/api/leagues/${league.id}/site`);
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const subdomain = (await res.json()).site.subdomain as string;
  res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'publish' } });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  for (const moduleKey of ['documents', 'divisions', 'gallery']) {
    res = await ownerApi.patch(`/api/leagues/${league.id}/site`, { data: { action: 'set_module', moduleKey, enabled: true } });
    expect(res.status(), await readErrorBody(res)).toBe(200);
  }
  return { admin, ownerApi, leagueId: league.id, subdomain };
}

test('one home: documents, logo, a header label, a subpage switch and the photo picks — all from the editor, live on publish', async ({ browser }) => {
  test.setTimeout(360_000);
  const stamp = Date.now();
  const { admin, ownerApi, leagueId, subdomain } = await setUp(stamp);
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });

      // Documents: written in the Documents section's panel.
      await page.locator('[data-sb-widget="documents"] .sb-frame-controls').click();
      const docs = page.locator('[data-sb-panel="documents"]');
      await expect(docs).toBeVisible();
      await docs.locator('[data-sb-document-add]').click();
      await docs.getByLabel('Document 1 title').fill(`Code of conduct ${stamp}`);
      await docs.getByLabel('Document 1 link').fill('https://example.com/code-of-conduct');
      await docs.getByRole('button', { name: 'Save content' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Saved to your draft' })).toBeVisible({ timeout: 15_000 });

      // The gallery's photo picks ride the gallery panel.
      await page.locator('[data-sb-widget="gallery"] .sb-frame-controls').click();
      await expect(page.locator('[data-sb-panel="gallery"] [data-sb-gallery-picks]')).toBeVisible();

      // Settings (the button clears the selection): the logo (live at once) …
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.locator('[data-sb-settings-panel]');
      await expect(settings.locator('[data-sb-logo]')).toBeVisible();
      await settings.locator('input[aria-label="Site logo file"]').setInputFiles(path.join(__dirname, 'fixtures', 'photo.png'));
      await expect(page.getByRole('heading', { name: 'Edit media' })).toBeVisible({ timeout: 15_000 });
      const uploaded = page.waitForResponse(r => r.url().includes('/site/logo') && r.request().method() === 'POST', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      expect((await uploaded).status()).toBe(200);
      await expect(settings.getByRole('button', { name: 'Replace logo' })).toBeVisible({ timeout: 20_000 });

      // … a header label …
      const nav = settings.locator('[data-sb-navigation]');
      await nav.getByLabel('Standings section label').fill('Tables');
      await nav.getByRole('button', { name: 'Save navigation' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Layout saved' })).toBeVisible({ timeout: 15_000 });

      // … and a subpage switched off: the draft is re-laid, the editor reloads from it.
      // A controlled checkbox: it flips when the server has answered and the
      // editor has reloaded — click, then wait for the reload.
      await nav.getByLabel('Toggle Divisions section').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Section updated' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-sb-canvas]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-sb-widget="divisions"]')).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await ctx.close();
    }

    await publishSite(ownerApi, 'league', leagueId, 'One home');
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const probe = await anon.request.get(`/org/${subdomain}`, { maxRedirects: 0 });
      const base = probe.status() === 301 ? `/${subdomain}` : `/org/${subdomain}`;
      const home = await settleBody(anon.request, base, '>Tables<', true, 12);
      expect(home, 'the logo shows in the header').toContain('/api/media/org-logo/');
      const documents = await settleBody(anon.request, `${base}/documents`, `Code of conduct ${stamp}`, true, 12);
      expect(documents).toContain('https://example.com/code-of-conduct');
      expect(await settleStatus(anon.request, `${base}/divisions`, 404)).toBe(404);
    } finally {
      await anon.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});

test('one home on a phone: Settings carries the logo and Subpages & navigation @mobile', async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const { admin, ownerApi, leagueId } = await setUp(stamp);
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}/site/edit`);
      await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 30_000 });
      const sheet = page.locator('[data-larger-window="sb-settings"]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-sb-logo]')).toBeVisible();
      await expect(sheet.locator('[data-sb-navigation]')).toBeAttached();
      await sheet.locator('[data-sb-navigation]').scrollIntoViewIfNeeded();
      await expect(sheet.getByLabel('Standings section label')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, 'no horizontal overflow at 390px').toBeLessThanOrEqual(390);
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});

test('one home: the console keeps settings only and deep-links into the editor — ?section selects, ?open opens Settings', async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const { admin, ownerApi, leagueId } = await setUp(stamp);
  try {
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', viewport: { width: 1280, height: 900 } });
    try {
      const page = await ctx.newPage();
      await page.goto(`/app/org/league/${leagueId}`);
      const links = page.locator('[data-console-editor-links]');
      await expect(links).toBeVisible({ timeout: 30_000 });
      // The moved blocks are gone from the console (one home).
      await expect(page.getByRole('button', { name: 'Save documents' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save navigation' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Upload logo' })).toHaveCount(0);
      await expect(page.getByLabel('New page title')).toHaveCount(0);
      // Documents → the editor, the Documents section selected.
      await links.getByRole('link', { name: 'Documents →' }).click();
      await expect(page).toHaveURL(/\/site\/edit\?section=documents$/);
      await expect(page.locator('[data-sb-panel="documents"] [data-sb-documents]')).toBeVisible({ timeout: 30_000 });
      // Header & subpages → Settings open.
      await page.goto(`/app/org/league/${leagueId}`);
      await page.locator('[data-console-editor-links]').getByRole('link', { name: 'Header & subpages →' }).click();
      await expect(page.locator('[data-sb-settings-panel] [data-sb-navigation]')).toBeVisible({ timeout: 30_000 });
    } finally {
      await ctx.close();
    }
  } finally {
    await ownerApi.dispose();
    await admin.from('org_sites').delete().eq('org_id', leagueId);
    await deleteQaOrgs(admin, [leagueId]);
  }
});
