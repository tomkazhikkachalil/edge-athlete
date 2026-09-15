import { test, expect } from '@playwright/test';
import { assertSuggestionsUsable } from './helpers/overlay';
import { cleanupEvent, createEvent, goLive, openEventSession } from './helpers/sport-events';

/**
 * Events program, phase 2b (B4) — the phone tab bar. Signed in at 390 the
 * bar shows five places and lights the right one on /feed, /sports/explore,
 * /calendar and an event's own page (Sports); it is tappable (nothing
 * paints over it); the body clears it; it hides on the wizard and on the
 * scorer's screen; the drawer still lists everything; signed out there is
 * no bar. Tagged @mobile on Chromium and WebKit.
 */
test('tab bar: five places, the active one, tappable, hidden where a screen owns its bottom edge @mobile', async ({ page, browser }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    await page.goto('/feed');
    const bar = page.locator('[data-tab-bar]');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar.locator('a')).toHaveCount(5);
    await expect(bar.locator('a')).toHaveText(['Feed', 'Sports', 'Live', 'Calendar', 'Profile']);
    await expect(page.locator('[data-tab="feed"]')).toHaveAttribute('aria-current', 'page');
    await assertSuggestionsUsable(page, { listSelector: '[data-tab-bar]', rowSelector: 'a', label: 'tab bar' });
    const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    expect(padding).toBeGreaterThan(40);

    // The drawer is still the superset.
    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    await expect(page.getByRole('button', { name: 'Sports' })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();

    // Tap through: Sports, Calendar.
    await page.locator('[data-tab="sports"]').click();
    await expect(page).toHaveURL(/\/sports/);
    await expect(page.locator('[data-tab="sports"]')).toHaveAttribute('aria-current', 'page');
    await page.locator('[data-tab="calendar"]').click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.locator('[data-tab="calendar"]')).toHaveAttribute('aria-current', 'page');

    // An event's own page lights Sports; the wizard hides the bar.
    // Dated TODAY: the Live counter (`isRoundLive`) admits a round within 48 h of its date only.
    const today = new Date().toISOString().slice(0, 10);
    const view = await createEvent(s.apiA, { name: `QA Tab Bar ${s.stamp}`, publish: true, round: { scheduled_on: today, course_name: 'QA Tab Links', holes: 9 } });
    eventId = view.event.id;
    await page.goto(`/events/${eventId}`);
    await expect(page.locator('[data-tab="sports"]')).toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
    await page.goto('/sports/events/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-tab-bar]')).toHaveCount(0);

    // Live: the dot on the tab, and the scorer's screen hides the bar.
    const live = await goLive(s.apiA, eventId, today);
    const gp = live.rounds[0].group_post_id as string;
    await page.goto('/feed');
    await expect(page.locator('[data-tab-live-dot]')).toBeVisible({ timeout: 20_000 });
    await page.goto(`/live/${gp}`);
    await expect(page.locator('[data-live-back]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-tab-bar]')).toHaveCount(0);
    const paddingLive = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    expect(paddingLive).toBe(0);

    // Signed out: no bar on a public page.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const p2 = await anon.newPage();
      await p2.goto('/sports/explore');
      await expect(p2.getByRole('link', { name: 'Log in' }).first()).toBeVisible({ timeout: 20_000 });
      await expect(p2.locator('[data-tab-bar]')).toHaveCount(0);
    } finally {
      await anon.close();
    }
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});

test('tab bar: absent on a large screen — the header keeps the places', async ({ page }) => {
  await page.goto('/feed');
  await expect(page.getByRole('navigation', { name: 'Main' }).or(page.locator('header'))).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tab-bar]')).toBeHidden();
  const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
  expect(padding).toBe(0);
});
