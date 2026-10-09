import { test, expect, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';

// Another user's profile card (Oct 9 2026): the cover photo fills the WHOLE
// card, edge to edge, clipped by its rounded corners and never spilling onto
// the page; the details sit on a translucent panel that follows the theme and
// repaints the moment the theme flips; a profile without a cover is a theme
// gradient. Held on both viewer routes (/athlete/<id> and /u/@handle), at
// desktop and phone width, as ANOTHER signed-in athlete (state-b).

const user = () => loadQaUser('user.json');

type Saved = { visibility: string | null; handle: string | null; cover_url: string | null };

/** Seeds a bright cover through storage + the profile row; returns the restore. */
async function seedCover(): Promise<{ handle: string; restore: () => Promise<void> }> {
  const admin = adminClient();
  const u = user();
  const { data: before } = await admin.from('profiles').select('visibility, handle, cover_url').eq('id', u.id).single();
  const saved = before as Saved;

  // A unique handle per run: the /u/ payload is CDN-cached by URL.
  const handle = `cv${u.id.replace(/-/g, '').slice(0, 10)}${Date.now().toString(36).slice(-6)}`;
  const png = await sharp({ create: { width: 600, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png()
    .toBuffer();
  const key = `covers/${u.id}/qa-cover-${Date.now()}.png`;
  const { error } = await admin.storage.from('uploads').upload(key, png, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`cover upload failed: ${error.message}`);
  const { data: pub } = admin.storage.from('uploads').getPublicUrl(key);
  await admin.from('profiles').update({ visibility: 'public', handle, cover_url: pub.publicUrl }).eq('id', u.id);

  return {
    handle,
    restore: async () => {
      try {
        await admin.from('profiles').update(saved).eq('id', u.id);
      } catch { /* the next step still runs */ }
      try {
        await admin.storage.from('uploads').remove([key]);
      } catch { /* the teardown sweep is the backstop */ }
    },
  };
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  return box!;
}

/** The photo layer fills the card (inside its 1px border), the panel sits within it. */
async function expectFilledCard(page: Page, label: string) {
  const card = '[data-profile-cover-card]';
  await expect(page.locator(card)).toBeVisible({ timeout: 25_000 });
  const outer = await boxOf(page, card);
  const photo = await boxOf(page, `${card} [data-profile-cover]`);
  const panel = await boxOf(page, `${card} [data-profile-panel]`);

  const B = 2; // the card's border + sub-pixel rounding
  expect(Math.abs(photo.x - outer.x), `${label}: photo left edge`).toBeLessThanOrEqual(B);
  expect(Math.abs(photo.y - outer.y), `${label}: photo top edge`).toBeLessThanOrEqual(B);
  expect(Math.abs(photo.x + photo.width - (outer.x + outer.width)), `${label}: photo right edge`).toBeLessThanOrEqual(B);
  expect(Math.abs(photo.y + photo.height - (outer.y + outer.height)), `${label}: photo bottom edge`).toBeLessThanOrEqual(B);

  expect(panel.x, `${label}: panel inside (left)`).toBeGreaterThanOrEqual(outer.x);
  expect(panel.y, `${label}: panel inside (top)`).toBeGreaterThanOrEqual(outer.y);
  expect(panel.x + panel.width, `${label}: panel inside (right)`).toBeLessThanOrEqual(outer.x + outer.width);
  expect(panel.y + panel.height, `${label}: panel inside (bottom)`).toBeLessThanOrEqual(outer.y + outer.height);

  const clip = await page.locator(card).first().evaluate(el => {
    const cs = getComputedStyle(el);
    return { overflow: cs.overflow, radius: parseFloat(cs.borderTopLeftRadius) };
  });
  expect(clip.overflow, `${label}: the card clips the photo`).toBe('hidden');
  expect(clip.radius, `${label}: rounded corners`).toBeGreaterThan(0);
  expect(await fitsViewportWidth(page), `${label}: no sideways scroll`).toBe(true);
}

async function expectPhotoLoaded(page: Page, label: string) {
  const img = page.locator('[data-profile-cover="photo"] img[loading="lazy"]');
  await expect(img, `${label}: the full cover is shown`).toHaveCSS('opacity', '1', { timeout: 20_000 });
  expect(await img.evaluate(el => (el as HTMLImageElement).naturalWidth), `${label}: the cover decoded`).toBeGreaterThan(0);
}

/** Flipping data-theme (what ThemeApplier does) repaints the glass in place. */
async function expectThemeFlip(page: Page, label: string) {
  const glass = page.locator('[data-profile-panel] .profile-glass');
  const read = () => glass.evaluate(el => getComputedStyle(el).backgroundColor);
  const flip = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      if (root.getAttribute('data-theme') === 'dark') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', 'dark');
    });
  const url = page.url();
  const first = await read();
  await flip();
  const second = await read();
  expect(second, `${label}: the panel follows the theme`).not.toBe(first);
  await flip();
  expect(await read(), `${label}: and flips back`).toBe(first);
  expect(page.url(), `${label}: no navigation`).toBe(url);
}

async function run(browser: Browser, viewport: { width: number; height: number } | null) {
  const u = user();
  const seeded = await seedCover();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  try {
    const page = await ctx.newPage();

    await page.goto(`/athlete/${u.id}`);
    await expectFilledCard(page, '/athlete/[id]');
    await expectPhotoLoaded(page, '/athlete/[id]');
    await expectThemeFlip(page, '/athlete/[id]');

    await page.goto(`/u/@${seeded.handle}`);
    await expectFilledCard(page, '/u');
    await expectPhotoLoaded(page, '/u');
    await expectThemeFlip(page, '/u');

    // No cover → the theme gradient (the uncached route).
    await adminClient().from('profiles').update({ cover_url: null }).eq('id', u.id);
    await page.goto(`/athlete/${u.id}`);
    await expectFilledCard(page, '/athlete/[id] no cover');
    const fill = page.locator('[data-profile-cover="gradient"]');
    await expect(fill).toBeVisible();
    expect(await fill.evaluate(el => getComputedStyle(el).backgroundImage), 'no cover: a gradient').toContain('gradient');
  } finally {
    await seeded.restore();
    await ctx.close();
  }
}

test('another profile: the cover fills the card under a theme-following panel (desktop)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await run(browser, page.viewportSize());
});

test('another profile: the cover fills the card under a theme-following panel @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await run(browser, page.viewportSize());
});
