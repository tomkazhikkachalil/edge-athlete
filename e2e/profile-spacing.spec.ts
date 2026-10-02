import { test, expect, type Browser, type Page } from '@playwright/test';
import { adminClient, loadQaUser } from './helpers/qa-user';
import { filterBarGaps, fitsViewportWidth } from './helpers/layout';

// Fix round part 5 (Oct 2 2026): on the profile's Stats tab the filter
// controls sat FLUSH on the grey "filters applied" strip, and the strip flush
// on the grid — 0 px each. The shared FilterBar returned two bare rows and
// leaned on a `space-y-6` parent; the Stats hub's parent had none. The bar
// carries its own spacing now. This spec holds the rendered gap — on every
// tab that uses the bar, on both profile routes, at desktop and phone width —
// so a host can never collapse it again.

/** The house gap between a filter row and what follows it is 16–24 px. */
const MIN_GAP = 16;

const user = () => loadQaUser('user.json');
const probeHandle = () => `spcqa${user().id.replace(/-/g, '').slice(0, 10)}`;

async function expectSpaced(page: Page, scope: string, label: string) {
  await expect(page.locator(`${scope} [data-filter-status]`)).toBeVisible({ timeout: 25_000 });
  // Let the tab's first fetch settle, so "next" is the grid or the empty
  // state rather than a spinner that is about to be replaced.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const gaps = await filterBarGaps(page, scope);
  expect(gaps, `${label}: the filter bar is on the page`).not.toBeNull();
  expect(gaps!.controlsToStatus, `${label}: filter controls → status strip`).toBeGreaterThanOrEqual(MIN_GAP);
  if (gaps!.statusToNext !== null) {
    expect(gaps!.statusToNext, `${label}: status strip → ${gaps!.next}`).toBeGreaterThanOrEqual(MIN_GAP);
  }
  expect(await fitsViewportWidth(page), `${label}: no sideways scroll`).toBe(true);
}

async function ownTabs(page: Page) {
  for (const tab of ['all', 'stats', 'tagged', 'achievements']) {
    await page.goto(`/athlete?tab=${tab}`);
    await expectSpaced(page, '#media-section', `/athlete ${tab}`);
  }
}

// The public route, seen by ANOTHER signed-in athlete: the owner's own
// /u/ link redirects to /athlete, and a signed-out visitor meets the launch
// gate on production. The viewer's context takes the calling test's viewport.
async function publicTabs(browser: Browser, viewport: { width: number; height: number } | null) {
  const admin = adminClient();
  const u = user();
  await admin.from('profiles').update({ visibility: 'public', handle: probeHandle() }).eq('id', u.id);
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/state-b.json', ...(viewport ? { viewport } : {}) });
  try {
    const page = await ctx.newPage();
    await page.goto(`/u/@${probeHandle()}?tab=stats`);
    // The Stats panel sits in the same card as the route's other sections.
    await expect(page.locator('[data-u-stats]')).toBeVisible({ timeout: 25_000 });
    await expectSpaced(page, '[data-u-stats]', '/u stats');
    await page.goto(`/u/@${probeHandle()}?tab=tagged`);
    await expectSpaced(page, '[data-u-tagged]', '/u tagged');
  } finally {
    await ctx.close();
    await admin.from('profiles').update({ visibility: 'private', handle: null }).eq('id', u.id);
  }
}

test('profile tabs: the filter bar never sits flush on what follows it (desktop)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await ownTabs(page);
  await publicTabs(browser, page.viewportSize());
});

test('profile tabs: the filter bar never sits flush on what follows it @mobile', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await ownTabs(page);
  await publicTabs(browser, page.viewportSize());
});
