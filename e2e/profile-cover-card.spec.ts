import { test, expect, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { fitsViewportWidth } from './helpers/layout';

// The profile card's header (Oct 9 2026, Tom): the cover photo is a banner and
// the profile picture straddles its bottom edge — half on the photo, half on
// the card — inset from the card's side. The same header on the owner's
// /athlete AND both viewer routes (/athlete/<id>, /u/@handle), at desktop and
// phone width; viewers are ANOTHER signed-in athlete (state-b).

const user = () => loadQaUser('user.json');

/** The smallest gap between the avatar and the card's side. */
const MIN_INSET = 8;
/** How far the photo's bottom edge may sit from the avatar's middle. */
const HALF_TOLERANCE = 4;

type Saved = { visibility: string | null; handle: string | null; cover_url: string | null };

async function seedCover(): Promise<{ handle: string; restore: () => Promise<void> }> {
  const admin = adminClient();
  const u = user();
  const { data: before } = await admin.from('profiles').select('visibility, handle, cover_url').eq('id', u.id).single();
  const saved = before as Saved;

  // A unique handle per run: the /u/ payload is CDN-cached by URL.
  const handle = `cv${u.id.replace(/-/g, '').slice(0, 10)}${Date.now().toString(36).slice(-6)}`;
  const png = await sharp({ create: { width: 600, height: 200, channels: 3, background: { r: 30, g: 120, b: 60 } } })
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

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `${selector} has a box`).not.toBeNull();
  return b!;
}

async function expectHalfOverAvatar(page: Page, kind: 'photo' | 'gradient', label: string) {
  const cover = `[data-profile-cover="${kind}"]`;
  await expect(page.locator(cover)).toBeVisible({ timeout: 25_000 });
  if (kind === 'photo') {
    const img = page.locator(`${cover} img`).first();
    await expect
      .poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth), { message: `${label}: the cover decoded`, timeout: 20_000 })
      .toBeGreaterThan(0);
  } else {
    expect(await page.locator(`${cover} > div`).first().evaluate(el => getComputedStyle(el).backgroundImage), `${label}: a gradient`).toContain('gradient');
  }

  const c = await box(page, cover);
  const a = await box(page, '[data-profile-avatar]');
  const coverBottom = c.y + c.height;
  const avatarMiddle = a.y + a.height / 2;
  expect(a.x - c.x, `${label}: avatar off the card's left side`).toBeGreaterThanOrEqual(MIN_INSET);
  expect(a.y, `${label}: avatar starts on the photo`).toBeGreaterThan(c.y);
  expect(Math.abs(avatarMiddle - coverBottom), `${label}: the photo's edge crosses the avatar's middle`).toBeLessThanOrEqual(HALF_TOLERANCE);

  const name = await box(page, 'h1');
  expect(name.y, `${label}: the name sits below the photo`).toBeGreaterThanOrEqual(coverBottom);
  expect(await fitsViewportWidth(page), `${label}: no sideways scroll`).toBe(true);
}

async function run(own: Page, browser: Browser, viewport: { width: number; height: number } | null) {
  const u = user();
  const seeded = await seedCover();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  try {
    // The owner's own page (the project's signed-in user IS the seeded one).
    await own.goto('/athlete');
    await expectHalfOverAvatar(own, 'photo', '/athlete (own)');

    const page = await ctx.newPage();

    await page.goto(`/athlete/${u.id}`);
    await expectHalfOverAvatar(page, 'photo', '/athlete/[id]');

    await page.goto(`/u/@${seeded.handle}`);
    await expectHalfOverAvatar(page, 'photo', '/u');

    // No cover → the gradient, same shape (the uncached route).
    await adminClient().from('profiles').update({ cover_url: null }).eq('id', u.id);
    await page.goto(`/athlete/${u.id}`);
    await expectHalfOverAvatar(page, 'gradient', '/athlete/[id] no cover');
  } finally {
    await seeded.restore();
    await ctx.close();
  }
}

test('profile header: the avatar sits half over the cover (desktop)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await run(page, browser, page.viewportSize());
});

test('profile header: the avatar sits half over the cover @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await run(page, browser, page.viewportSize());
});
