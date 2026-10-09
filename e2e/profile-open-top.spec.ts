import { test, expect, type Page } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';

// A profile opens at the TOP (Oct 9 2026, Tom: "fix the scroll on my own
// profile"). The media tabs kept their active tab visible with
// scrollIntoView({ inline: 'nearest', block: 'nearest' }) on mount — and when
// the strip sat below the fold, "nearest" scrolled the PAGE down to it: the
// owner's /athlete opened ~90 px down on a phone and ~200 px on a desktop.
// The strip now moves itself only (`nearestScrollLeft`). Held on the owner's
// page and the viewer route at desktop and phone width; the deep-link half
// (?tab=vitals lands the tab in the strip) stays with vitals-mobile.spec.

/** The page must not move on its own for this long after load. */
const SETTLE_MS = 3_000;

async function expectOpensAtTop(page: Page, url: string, label: string) {
  await page.goto(url);
  await expect(page.locator('[data-profile-cover]')).toBeVisible({ timeout: 25_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  expect(await page.evaluate(() => window.scrollY), `${label}: still at the top`).toBe(0);
}

async function run(page: Page, browser: import('@playwright/test').Browser) {
  await expectOpensAtTop(page, '/athlete', '/athlete (own)');

  // The viewer route, as another signed-in athlete; A is public for the visit.
  const admin = adminClient();
  const u = loadQaUser('user.json');
  const { data: before } = await admin.from('profiles').select('visibility').eq('id', u.id).single();
  await admin.from('profiles').update({ visibility: 'public' }).eq('id', u.id);
  const viewport = page.viewportSize();
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  try {
    await expectOpensAtTop(await ctx.newPage(), `/athlete/${u.id}`, '/athlete/[id]');
  } finally {
    await ctx.close();
    await admin.from('profiles').update({ visibility: before?.visibility ?? 'private' }).eq('id', u.id);
  }
}

test('a profile opens at the top (desktop)', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await run(page, browser);
});

test('a profile opens at the top @mobile', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await run(page, browser);
});
