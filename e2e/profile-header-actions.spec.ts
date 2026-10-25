import { test, expect, type Browser, type Page } from './helpers/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// The profile header, Oct 14 2026 (Tom's fixes 3 + 5): the title card with its
// back arrow is gone — the cover card is the first thing under the header;
// the "…" menu (Report profile) is a scrim disc in the cover's top-right
// corner; on your own profile that corner is the Edit profile pencil; the
// fan button sits in the stats row as half of the Message + Become a Fan
// pair (the Message half arrives with the Message door). Both routes.

const userA = () => loadQaUser('user.json');
const probeHandle = () => `hdrqa${userA().id.replace(/-/g, '').slice(0, 10)}`;

/** The alpha of an element's background — `rgba(r, g, b, a)` (Chromium) or
 *  the slash form `color(srgb r g b / a)` / `oklab(… / a)` (Tailwind v4's
 *  `bg-black/50` is a color-mix, which WebKit serialises that way). */
async function alphaRgb(page: Page, selector: string): Promise<number> {
  const bg = await page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor);
  const slash = bg.match(/\/\s*([\d.]+%?)\s*\)\s*$/);
  if (slash) return slash[1].endsWith('%') ? Number(slash[1].slice(0, -1)) / 100 : Number(slash[1]);
  const m = bg.match(/rgba?\(([^)]+)\)/);
  const parts = m ? m[1].split(',').map(v => Number(v.trim())) : [];
  return parts.length === 4 ? parts[3] : 1;
}

/** What a signed-in VIEWER sees on A's profile (either route). */
async function viewerChecks(page: Page, label: string) {
  await expect(page.locator('[data-profile-cover]')).toBeVisible({ timeout: 25_000 });
  // No title card, no back control.
  await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Athlete Profile' })).toHaveCount(0);
  // The corner menu: on the photo, translucent, opens Report profile.
  const cover = (await page.locator('[data-profile-cover]').boundingBox())!;
  const menu = page.locator('[data-profile-menu]');
  await expect(menu).toBeVisible();
  const mb = (await menu.boundingBox())!;
  expect(mb.y, `${label}: the menu sits inside the cover`).toBeGreaterThanOrEqual(cover.y - 1);
  expect(mb.x + mb.width, `${label}: at the cover's right edge`).toBeLessThanOrEqual(cover.x + cover.width + 1);
  expect(await alphaRgb(page, '[data-profile-menu]'), `${label}: a scrim, not a solid`).toBeLessThan(1);
  await menu.click();
  await page.locator('[data-menu-item="report"]').click();
  const sheet = page.getByRole('dialog', { name: 'Report this profile' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // The fan button lives in the stats row, within the viewport.
  const actions = page.locator('[data-profile-stats] [data-profile-actions]');
  await expect(actions).toBeVisible({ timeout: 15_000 });
  const fan = actions.getByRole('button', { name: /^(Become a Fan|Fan|Requested)$/ });
  await expect(fan).toBeVisible({ timeout: 15_000 });
  const fb = (await fan.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(fb.x, `${label}: the fan button starts on screen`).toBeGreaterThanOrEqual(0);
  expect(fb.x + fb.width, `${label}: and ends on screen`).toBeLessThanOrEqual(vw + 1);
  expect(fb.height, `${label}: the pair's height`).toBeGreaterThanOrEqual(40);
}

async function run(browser: Browser, viewport: { width: number; height: number } | null, label: string) {
  const admin = adminClient();
  const a = userA();
  // A public with a handle, so B reaches the full card on both routes.
  await admin.from('profiles').update({ visibility: 'public', handle: probeHandle() }).eq('id', a.id);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  try {
    const page = await ctx.newPage();
    await page.goto(`/athlete/${a.id}`);
    await viewerChecks(page, `${label} /athlete/[id]`);
    await page.goto(`/u/@${probeHandle()}`);
    await viewerChecks(page, `${label} /u/`);
    await expect(page.getByRole('link', { name: 'View Full Profile' })).toBeVisible();
  } finally {
    await ctx.close();
    await admin.from('profiles').update({ visibility: 'private', handle: null }).eq('id', a.id);
  }
}

async function ownerChecks(page: Page) {
  await page.goto('/athlete');
  await expect(page.locator('[data-profile-cover]')).toBeVisible({ timeout: 25_000 });
  const pencil = page.locator('[data-profile-cover] [data-profile-edit]');
  await expect(pencil).toBeVisible();
  await expect(page.locator('[data-profile-menu]')).toHaveCount(0);
  // Convention 52 (Oct 25 2026): the owner's view is the visitor's view plus
  // this ONE control — no inline editor, no "add your …" prompt, no empty-slot
  // photo button on the profile itself.
  await expect(page.locator('[data-profile-edit]')).toHaveCount(1);
  await expect(page.getByLabel('X handle')).toHaveCount(0);
  await expect(page.getByText('Add your bio')).toHaveCount(0);
  await expect(page.getByText('Add your name in Edit Profile')).toHaveCount(0);
  await expect(page.locator('[data-sports-empty], [data-add-avatar], [data-add-cover]')).toHaveCount(0);
  await expect(page.locator('[data-profile-cover]').locator('input')).toHaveCount(0);
  await pencil.click();
  await expect(page.getByRole('dialog', { name: 'Edit Profile', exact: true })).toBeVisible({ timeout: 15_000 });
}

test('profile header: no back card, the corner menu, the fan button in the stats row — both routes', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await run(browser, null, 'desktop');
  await ownerChecks(page);
});

test('profile header at a phone width: the corner menu and the fan button fit — both routes @mobile', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await run(browser, { width: 375, height: 812 }, 'phone');
  await page.setViewportSize({ width: 375, height: 812 });
  await ownerChecks(page);
});
