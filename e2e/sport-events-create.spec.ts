import { test, expect } from '@playwright/test';
import { apiAs } from './helpers/qa-user';

/**
 * Events program — the creation wizard at /sports/events/new. Four steps
 * with the refusal copy, an off-catalog course typed as a name, a back
 * nine, net format, Publish → the event's place, status Open. Cancel on a
 * dirty form asks first. Tagged @mobile: single column, 44px controls, the
 * sticky footer above the safe area, on Chromium and WebKit at 390px.
 */
test('event wizard: refusals, typed course, back nine, publish → the place; cancel asks @mobile', async ({ page }) => {
  const stamp = Date.now();
  const name = `QA Wizard ${stamp}`;
  await page.goto('/sports/events/new');
  await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 20_000 });

  // Basics: a name is required.
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText('Give the event a name.');
  await page.locator('[data-event-wizard-name]').fill(name);
  await page.getByRole('radio', { name: 'Open to requests' }).check();
  await page.locator('[data-event-wizard-next]').click();

  // Round: the date, then a course typed as a name, a back nine.
  await expect(page.locator('[data-event-wizard="round"]')).toBeVisible();
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText('Pick the date.');
  await page.locator('[data-event-wizard-date]').fill('2030-06-01');
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText('Pick a course, or type its name.');
  await page.locator('[data-course-search]').fill(`QA Wizard Links ${stamp}`);
  await page.locator('[data-course-typed]').click();
  await expect(page.locator('[data-course-picked="typed"]')).toBeVisible();
  await page.getByRole('radio', { name: '9 holes' }).check();
  await page.getByRole('radio', { name: 'Hole 10 (back nine)' }).check();
  await page.locator('[data-event-wizard-next]').click();

  // Format: net, a field of 8.
  await expect(page.locator('[data-event-wizard="format"]')).toBeVisible();
  await page.getByRole('radio', { name: /Stroke play · Net/ }).check();
  await page.getByPlaceholder('No limit').fill('8');
  await page.locator('[data-event-wizard-next]').click();

  // Review carries the choices; Publish lands on the place, open.
  await expect(page.locator('[data-event-wizard="review"]')).toBeVisible();
  await expect(page.getByText('9 holes from the 10th')).toBeVisible();
  await expect(page.getByText('Stroke play · Net')).toBeVisible();
  await expect(page.getByText('8 players')).toBeVisible();
  await page.locator('[data-event-wizard-publish]').click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-event-status-chip]')).toHaveText(/Open/);
  const eventId = page.url().split('/events/')[1];

  // Cancel on a dirty form asks first; Keep editing stays.
  await page.goto('/sports/events/new');
  await page.locator('[data-event-wizard-name]').fill('Half typed');
  await page.locator('[data-event-wizard-cancel]').click();
  await expect(page.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.locator('[data-event-wizard-name]')).toHaveValue('Half typed');

  const api = await apiAs('state.json');
  try {
    await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } });
    await api.delete(`/api/sport-events/${eventId}`);
  } finally {
    await api.dispose();
  }
});
