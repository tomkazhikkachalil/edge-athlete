import { test, expect } from './helpers/test';
import { loadQaUser, resetGetStarted } from './helpers/qa-user';

/**
 * First-run Get Started checklist (#344) at phone width (Web & Mobile Ship
 * Together). Asserted at 375px — the mobile project runs 390×844, and this
 * card's rows are exactly the kind of layout where those 15px matter.
 *
 * The card gates on account age (<14 days — the per-run QA user is always
 * fresh), the localStorage dismiss key (clean per context: minted storage
 * state carries no origins), and the steps API. The API is STUBBED here so
 * the assertions are about layout and behavior, not about whatever data
 * earlier specs left on the shared QA user; the real endpoint is covered by
 * the desktop prod probes.
 */

const STUBBED_STEPS = {
  hasRound: false,
  hasAvatar: false,
  followingCount: 1,
  hasCompetitive: false,
};

test('@mobile the first-run checklist is usable at phone width', { tag: '@smoke' }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/profile/getting-started', route =>
    route.fulfill({ json: STUBBED_STEPS })
  );

  await page.goto('/feed');
  const card = page.getByTestId('get-started-card');
  await expect(card).toBeVisible({ timeout: 15_000 });

  // All four steps, with the follow counter interpolated.
  await expect(card.locator('li')).toHaveCount(4);
  await expect(card.getByText('Follow 3 athletes (1/3)')).toBeVisible();

  // Nothing overflows the 375px viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Every CTA holds the 44px touch floor (the polish pass's fix — they were
  // ~20px bare text links).
  for (const name of ['Log a round', 'Add photo', 'Find athletes', 'Set level']) {
    const box = await card.getByText(name, { exact: true }).boundingBox();
    expect(box, `${name} has a bounding box`).not.toBeNull();
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }

  // Dismiss is a real 40px circle (44 effective via the ea-icon-btn ring) and
  // must not be flex-compressed by the title at this width.
  const dismiss = card.getByRole('button', { name: 'Dismiss get started checklist' });
  const dBox = await dismiss.boundingBox();
  expect(dBox!.width).toBeGreaterThanOrEqual(40);
  expect(dBox!.height).toBeGreaterThanOrEqual(40);

  // "Set level" deep-links into the Edit Profile modal — the step used to
  // drop users at the top of /athlete with navigation instructions as a hint.
  await card.getByText('Set level', { exact: true }).click();
  await page.waitForURL('**/athlete?edit=sport', { timeout: 15_000 });
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  // …on the Sports tab (Program D): one tab, the setup as steps.
  await expect(page.getByRole('dialog', { name: 'Edit Profile', exact: true }).locator('[data-sports-tab]')).toBeVisible({ timeout: 15_000 });

  // Back on the feed the card is still offered (not yet dismissed)… — in a
  // FRESH page of the same context (the dismiss key is localStorage, shared
  // per context). Never page.goto from here: the "Set level" soft
  // navigation can leave an RSC request still streaming, WebKit aborts it
  // when the page unloads, and Next's router answers the aborted fetch with
  // a HARD navigation back to /athlete?edit=sport — which interrupts the
  // goto (the CI flake of Sep 29 2026, read off the trace: the goto's /feed
  // document aborted, then a /athlete?edit=sport document 200).
  const feed = await page.context().newPage();
  await feed.setViewportSize({ width: 375, height: 812 });
  await feed.route('**/api/profile/getting-started', route =>
    route.fulfill({ json: STUBBED_STEPS })
  );
  await page.close();
  await feed.goto('/feed');
  const feedCard = feed.getByTestId('get-started-card');
  await expect(feedCard).toBeVisible({ timeout: 15_000 });

  // …and dismissal hides it now and across a reload (localStorage).
  await feedCard.getByRole('button', { name: 'Dismiss get started checklist' }).click();
  await expect(feedCard).toBeHidden();
  await feed.reload();
  await expect(feed.getByRole('button', { name: /create a post/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(feed.getByTestId('get-started-card')).toHaveCount(0);
});

// Decisions round (Oct 22 2026), Tom: "reserve its space". On a cold load the
// card used to appear only when its steps API answered (~2.3 s on a mid-range
// Android) and pushed the whole feed down (CLS 0.35). Now the client decides
// from the profile it already holds and the card is on screen from the first
// paint, resolving; the API fills the rows in inside a box that keeps its
// height. Layout shift is read off the page itself (PerformanceObserver —
// Chromium only; WebKit reports no layout-shift entries).
test('@mobile the checklist holds its place: on screen before its API answers, and nothing under it moves', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'layout-shift entries are a Chromium metric');
  await page.setViewportSize({ width: 375, height: 812 });
  type ClsWindow = Window & { __cls: number; __clsLog: string[] };
  await page.addInitScript(() => {
    const w = window as unknown as ClsWindow;
    w.__cls = 0;
    w.__clsLog = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Array<{ node?: Element | null }> }>) {
        if (e.hadRecentInput) continue;
        // The suggestions block is its own story: with nothing to suggest it
        // collapses by design (no empty state), which an account with an
        // empty feed sees in the same viewport. Not this card's shift.
        const sources = e.sources ?? [];
        if (sources.length > 0 && sources.every(src => !!(src.node as Element | null)?.closest?.('[data-feed-suggestions]'))) continue;
        w.__cls += e.value;
        w.__clsLog.push(`${e.value.toFixed(3)} @${Math.round(e.startTime)}ms ${(e.sources ?? []).map(src => (src.node as Element | null)?.outerHTML?.slice(0, 70).replace(/\s+/g, ' ') ?? '?').join(' | ')}`);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  let answered = false;
  await page.route('**/api/profile/getting-started', async route => {
    await new Promise(r => setTimeout(r, 2500));
    answered = true;
    await route.fulfill({ json: STUBBED_STEPS });
  });

  await page.goto('/feed');
  const card = page.getByTestId('get-started-card');
  // On screen while the API is still out, with its rows already drawn.
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(answered, 'the card showed before its API answered').toBe(false);
  await expect(card).toHaveAttribute('data-get-started', 'resolving');
  await expect(card.locator('li')).toHaveCount(4);
  const before = await card.boundingBox();
  // From here on: the shift the CARD's resolution causes (the page's own
  // loader-to-feed swap before this point is not this card's).
  await page.evaluate(() => { const w = window as unknown as ClsWindow; w.__cls = 0; w.__clsLog = []; });

  // The answer lands: the rows resolve in place, the box does not move or shrink.
  await expect(card).toHaveAttribute('data-get-started', 'resolved', { timeout: 15_000 });
  await expect(card.getByText('Follow 3 athletes (1/3)')).toBeVisible();
  const after = await card.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.height).toBeGreaterThanOrEqual(before!.height - 1);
  await page.waitForTimeout(1000);
  const { cls, log } = await page.evaluate(() => { const w = window as unknown as ClsWindow; return { cls: w.__cls, log: w.__clsLog }; });
  expect(cls, `layout shift after the card showed:\n${log.join('\n')}`).toBeLessThan(0.1);
});

// Quick fixes, PR 3 (Oct 2026). Tom: "If the user closes the suggestions,
// they should stay closed." The X was remembered in one browser's
// localStorage, so any fresh storage — a second device, a private window, the
// app installed from the home screen — showed the card again. No stub here:
// the card is closed for real in one browser context, and a SECOND context
// with empty storage (the same account) must not be offered it.
test('@mobile the checklist, once closed, stays closed in a browser that never saw it', async ({ browser }) => {
  test.setTimeout(120_000);
  const alpha = loadQaUser('user.json');
  await resetGetStarted(alpha.id);
  const viewport = { width: 390, height: 844 };
  const first = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport });
  const second = await browser.newContext({ storageState: 'e2e/.auth/state.json', viewport });
  try {
    const page = await first.newPage();
    await page.goto('/feed');
    const card = page.getByTestId('get-started-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    const saved = page.waitForResponse(r => r.url().includes('/api/profile/getting-started') && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Dismiss get started checklist' }).click();
    await expect(card).toHaveCount(0);
    expect((await saved).ok()).toBe(true);

    // Another browser, same account, nothing in storage: the account remembers.
    const other = await second.newPage();
    const asked = other.waitForResponse(r => r.url().includes('/api/profile/getting-started') && r.request().method() === 'GET');
    await other.goto('/feed');
    expect((await (await asked).json()).dismissed).toBe(true);
    await expect(other.getByRole('tab', { name: 'Following' })).toBeVisible({ timeout: 20_000 });
    await expect(other.getByTestId('get-started-card')).toHaveCount(0);
    // …and that browser now knows too: no request on its next visit.
    const again = await second.newPage();
    let askedAgain = false;
    again.on('request', r => {
      if (r.url().includes('/api/profile/getting-started')) askedAgain = true;
    });
    await again.goto('/feed');
    await expect(again.getByRole('tab', { name: 'Following' })).toBeVisible({ timeout: 20_000 });
    await expect(again.getByTestId('get-started-card')).toHaveCount(0);
    expect(askedAgain).toBe(false);
  } finally {
    await first.close().catch(() => null);
    await second.close().catch(() => null);
    await resetGetStarted(alpha.id);
  }
});
