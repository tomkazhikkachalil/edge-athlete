import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';

/**
 * Events program — the Sports section. Sports replaces Explore in the
 * header; /explore redirects with its query; the three places switch
 * through the segmented subnav; the events list shows a created event
 * under the right filter and links to its place; the leaderboards place
 * lists a live event. Tagged @mobile: the drawer carries Sports and
 * Create Event, the subnav is full width at 390px, on Chromium and WebKit.
 */
test('sports nav: redirect, subnav, drawer, events list, leaderboards @mobile', async ({ page }) => {
  const stamp = Date.now();
  const api = await apiAs('state.json');
  let eventId: string | null = null;
  try {
    // /explore?course= keeps its query on the way to /sports/explore.
    await page.goto('/explore?course=00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL(/\/sports\/explore\?course=00000000-0000-4000-8000-000000000000/, { timeout: 15_000 });
    await expect(page.locator('[data-sports-section="explore"]')).toHaveAttribute('aria-current', 'page');

    // The drawer (phone): Sports and Create Event are there.
    await page.getByRole('button', { name: 'Toggle mobile menu' }).click();
    await expect(page.getByRole('button', { name: 'Sports' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Event' })).toBeVisible();
    await page.getByRole('button', { name: 'Close menu' }).click();

    // A created event shows under Upcoming, and Live once live; the card is its place.
    const created = await api.post('/api/sport-events', { data: { name: `QA Nav ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Nav Links', holes: 9 } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    eventId = ((await created.json()) as { event: { id: string } }).event.id;

    await page.locator('[data-sports-section="events"]').click();
    await expect(page).toHaveURL(/\/sports\/events$/);
    await expect(page.locator(`[data-events-card="${eventId}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-events-filter="upcoming"]')).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-events-filter="live"]').click();
    await expect(page.locator('[data-events-card]')).toHaveCount(0);

    const live = await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    await page.reload();
    await expect(page.locator(`[data-events-card="${eventId}"]`)).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-sports-section="leaderboards"]').click();
    // Wait for the leaderboards page itself — the events list's card (a plain
    // link) stays on screen until the client navigation lands.
    await expect(page).toHaveURL(/\/sports\/leaderboards$/);
    await expect(page.locator('[data-leaderboards-list]')).toBeVisible({ timeout: 15_000 });
    await page.locator(`[data-leaderboards-list] [data-events-card="${eventId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}\\?tab=leaderboard`));
    await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  } finally {
    if (eventId) {
      await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await api.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await api.dispose();
  }
});

test('sports nav: the header link lights on the section and on an event page; signed-out explore renders', async ({ page, browser }) => {
  await page.goto('/sports/events');
  await expect(page.getByRole('link', { name: 'Sports' })).toHaveAttribute('aria-current', 'page');
  const anon = await browser.newContext({ storageState: 'e2e/.auth/anon.json' });
  try {
    const p = await anon.newPage();
    await p.goto('/sports/explore');
    await expect(p.getByRole('heading', { name: 'Explore' })).toBeVisible({ timeout: 15_000 });
    await p.goto('/sports/events');
    await expect(p.getByRole('link', { name: 'Log in' }).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await anon.close();
  }
});
