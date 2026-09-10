import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { adminClient, apiAs, loadQaUser, readErrorBody, resetRateBucket } from './helpers/qa-user';
import { revisionsSupported } from './helpers/org-site';
import { openManageMenu } from './helpers/org-page';

// Org Pages R2: the in-app club/league page carries the org's brand — logo,
// hero photo, accent — from the org GET's `brand`, for EVERYONE, published
// or not (Tom, Sep 8 2026: the org is live by link; the bytes were already
// anonymous through the tokenless streamers). Managers see a "Site draft"
// pill on a draft. Below sm the secondary actions live behind "More
// actions" (a LargerWindow sheet); from sm: up they are pills + links.
//
// Seeding: a club owned by QA user A, a DRAFT site (never published), a
// theme accent, a hero photo (site asset → set_hero) and a logo.

const PHOTO = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo.png'));

async function seedBrandedClub(ownerApi: APIRequestContext, stamp: number) {
  const admin = adminClient();
  const owner = loadQaUser('user.json');
  await resetRateBucket(admin, 'upload', owner.id);
  const { data: club, error } = await admin
    .from('clubs')
    .insert({ name: `QA Brand Club ${stamp}`, description: 'Brand probe club', owner_profile_id: owner.id })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  const clubId = club!.id as string;
  const { error: me } = await admin
    .from('memberships')
    .insert([{ club_id: clubId, profile_id: owner.id, role: 'owner', kind: 'follow' }]);
  expect(me, me?.message).toBeNull();

  let res = await ownerApi.post(`/api/clubs/${clubId}/site`);
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const site = (await res.json()).site as { id: string };
  res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
    data: { action: 'set_theme', accent: '#0f766e', accentStrong: '#0b3d91' },
  });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  res = await ownerApi.post(`/api/clubs/${clubId}/site/assets`, {
    multipart: { image: { name: 'hero.png', mimeType: 'image/png', buffer: PHOTO } },
  });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const assetPath = (await res.json()).path as string;
  res = await ownerApi.patch(`/api/clubs/${clubId}/site`, {
    data: { action: 'set_hero', headline: `Play here ${stamp}`, tagline: 'Since 1962', imagePath: assetPath, imageAlt: 'The first tee' },
  });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  res = await ownerApi.post(`/api/clubs/${clubId}/site/logo`, {
    multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: PHOTO } },
  });
  expect(res.status(), await readErrorBody(res)).toBe(200);
  const { data: siteRow } = await admin.from('org_sites').select('logo_path').eq('id', site.id).maybeSingle();

  return {
    clubId,
    async teardown() {
      await admin.from('clubs').delete().eq('id', clubId);
      const keys = [assetPath, siteRow?.logo_path as string | null].filter((k): k is string => !!k);
      if (keys.length) await admin.storage.from('uploads').remove(keys);
    },
  };
}

async function expectBrand(page: Page, clubId: string, stamp: number) {
  await page.goto(`/club/${clubId}`);
  await expect(page.getByRole('heading', { name: `QA Brand Club ${stamp}` })).toBeVisible({ timeout: 20_000 });
  // The hero photo through the org-media streamer, under the scrim.
  const hero = page.locator('[data-org-hero="photo"]');
  await expect(hero).toBeVisible();
  const heroImg = hero.locator('img[data-org-hero-image]');
  await expect(heroImg).toHaveAttribute('src', /^\/api\/media\/org-media\//);
  // The logo tile through the org-logo streamer.
  const logoImg = page.locator('[data-org-logo="image"] img');
  await expect(logoImg).toHaveAttribute('src', /^\/api\/media\/org-logo\//);
  // Counting is not seeing: both streamers must actually deliver bytes the
  // browser decodes (a draft site included).
  await expect.poll(() => heroImg.evaluate(i => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => logoImg.evaluate(i => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  // The tagline reaches the page; the accent reaches the scope as inline vars.
  await expect(page.getByText('Since 1962')).toBeVisible();
  const style = await page.locator('.org-app-scope').first().getAttribute('style');
  expect(style).toContain('--org-accent: #0f766e');
  expect(style).toContain('--org-accent-strong: #0b3d91');
  // Let the hero's pop-in entrance (350ms, scale 0.96 → 1) finish before
  // anything below measures geometry — a box read mid-entrance is 4% short.
  await hero.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  // Nothing pushes the page wider than the viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  return hero;
}

/** Optional visual dump (the share-card spec's E2E_DUMP_DIR precedent): the
 *  hero in both themes at this viewport, once the viewer's controls exist. */
async function dumpHero(page: Page, hero: ReturnType<Page['locator']>, tag: string) {
  const dump = process.env.E2E_DUMP_DIR;
  if (!dump) return;
  const w = page.viewportSize()?.width ?? 0;
  await hero.screenshot({ path: path.join(dump, `org-hero-${tag}-${w}-light.png`) });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await hero.screenshot({ path: path.join(dump, `org-hero-${tag}-${w}-dark.png`) });
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.waitForTimeout(200);
}

test('org page brand: a draft site\'s logo, hero photo and accent render in-app; managers see the draft pill', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const ownerApi = await apiAs('state.json');
  const seeded = await seedBrandedClub(ownerApi, stamp);

  // H3: a DRAFT site's stored draft layout (a paragraph typed in the editor)
  // must never reach the in-app composition — the layout comes from the
  // published revision only, and this site has none.
  if (await revisionsSupported(ownerApi, 'club', seeded.clubId)) {
    const canvas = (await (await ownerApi.get(`/api/clubs/${seeded.clubId}/site/canvas`)).json()) as { layout: { widgets: { y: number; h: number }[] } };
    const bottom = Math.max(...canvas.layout.widgets.map(w => w.y + w.h));
    const draftLayout = { ...canvas.layout, widgets: [...canvas.layout.widgets, { id: 'w_000000000000d3a1', key: 'text', x: 0, y: bottom, w: 12, h: 3, cv: 1, visibility: 'public', config: { blocks: [{ type: 'paragraph', text: `Draft only ${stamp}` }] } }] };
    const put = await ownerApi.put(`/api/clubs/${seeded.clubId}/site/draft`, { data: { layout: draftLayout } });
    expect(put.status(), await readErrorBody(put)).toBe(200);
    const org = (await (await ownerApi.get(`/api/clubs/${seeded.clubId}`)).json()) as { composition: unknown; brand: { headline?: string | null } | null };
    expect(org.composition, 'no published revision → no composition, draft or not').toBeNull();
  }
  try {
    // Owner (the default storage state) at desktop width.
    const hero = await expectBrand(page, seeded.clubId, stamp);
    await expect(page.locator('[data-site-draft]')).toBeVisible();
    // Draft: no "Public site" door; the manager doors live behind Manage
    // (P1-A) — nothing in the open, everything in the popover.
    await expect(page.getByRole('link', { name: 'Public site →' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage club →' })).toHaveCount(0);
    const menu = await openManageMenu(page);
    await expect(menu.getByRole('link', { name: 'Manage club →' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Edit club' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Share join link' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Public site →' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await dumpHero(page, hero, 'owner');

    // A visitor sees the same brand and no draft pill.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const anonPage = await anon.newPage();
      const anonHero = await expectBrand(anonPage, seeded.clubId, stamp);
      await expect(anonPage.locator('[data-site-draft]')).toHaveCount(0);
      await expect(anonPage.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0);
      await dumpHero(anonPage, anonHero, 'visitor');
    } finally {
      await anon.close();
    }
  } finally {
    await seeded.teardown();
    await ownerApi.dispose();
  }
});

test('@mobile org page brand at phone width: the staff actions live behind Manage', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const ownerApi = await apiAs('state.json');
  const seeded = await seedBrandedClub(ownerApi, stamp);
  try {
    const hero = await expectBrand(page, seeded.clubId, stamp);
    await expect(page.locator('[data-site-draft]')).toBeVisible();
    // Below sm nothing sits in the open; the sheet carries the same rows.
    await expect(page.getByRole('link', { name: 'Manage club →' })).toHaveCount(0);
    const more = page.getByRole('button', { name: 'Manage', exact: true });
    await expect(more).toBeVisible();
    await dumpHero(page, hero, 'owner');
    const box = await more.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    await more.click();
    const sheet = page.locator('[data-larger-window="hero-actions"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Manage club →' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit club' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Share join link' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await seeded.teardown();
    await ownerApi.dispose();
  }
});
