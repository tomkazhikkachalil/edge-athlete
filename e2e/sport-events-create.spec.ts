import { test, expect } from '@playwright/test';
import { adminClient, apiAs } from './helpers/qa-user';

/**
 * Events program — the creation wizard at /sports/events/new. Four steps
 * with the refusal copy, an off-catalog course typed as a name, a back
 * nine, net format, Publish → the event's place, status Open. Cancel on a
 * dirty form asks first. Phase 2: Add a round (the course copied, the
 * refusal names the round and the order), and a two-round tournament
 * lands on a place that reads "Round 1 of 2". Tagged @mobile: single column, 44px controls, the
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

  // Phase 2: Add a round copies the course with an empty date; the refusal names the round, then the order; remove it again.
  await page.locator('[data-wizard-add-round]').click();
  await expect(page.locator('[data-wizard-round="2"]')).toBeVisible();
  await expect(page.locator('[data-wizard-round="2"] [data-course-picked="typed"]')).toBeVisible();
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText('Round 2: Pick the date.');
  await page.locator('[data-wizard-round="2"] [data-event-wizard-date]').fill('2030-05-31');
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText('Round 2 must not be before round 1.');
  await page.locator('[data-wizard-round-remove="2"]').click();
  await expect(page.locator('[data-wizard-round="2"]')).toHaveCount(0);
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

  // A two-round tournament from the wizard: the review sums it up; the place reads "Round 1 of 2".
  const name2 = `QA Wizard Tourney ${stamp}`;
  await page.locator('[data-event-wizard-name]').fill(name2);
  await page.locator('[data-event-wizard-next]').click();
  await page.locator('[data-event-wizard-date]').fill('2030-06-01');
  await page.locator('[data-course-search]').fill(`QA Tourney Links ${stamp}`);
  await page.locator('[data-course-typed]').click();
  await page.locator('[data-wizard-add-round]').click();
  await page.locator('[data-wizard-round="2"] [data-event-wizard-date]').fill('2030-06-02');
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard="format"]')).toBeVisible();
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.getByText('2 rounds · Jun 1 – Jun 2, 2030')).toBeVisible();
  await page.locator('[data-event-wizard-publish]').click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.locator('[data-event-round-line]')).toHaveText(/Round 1 of 2/, { timeout: 20_000 });
  const eventId2 = page.url().split('/events/')[1];

  const api = await apiAs('state.json');
  try {
    for (const id of [eventId, eventId2]) {
      await api.post(`/api/sport-events/${id}/transition`, { data: { to: 'cancelled' } });
      await api.delete(`/api/sport-events/${id}`);
    }
  } finally {
    await api.dispose();
  }
});

/**
 * Phase 4 (215): the wizard's team path — the sport picker, Game | Session,
 * the game's date / place / time, the two sides, the review, Publish → the
 * place shows the kind, the place and the sides. NEEDS MIGRATION 215 ON
 * THE TARGET (self-skips before).
 */
test('event wizard: a hockey game — sport, kind, place and time, the sides, publish → the place @mobile', async ({ page }) => {
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('shape').limit(1);
  test.skip(!!probe.error, 'sport_events.shape missing — run migration 215');
  const stamp = Date.now();
  const name = `QA Wizard Game ${stamp}`;
  await page.goto('/sports/events/new');
  await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-event-wizard-name]').fill(name);
  await page.getByRole('radio', { name: 'Ice Hockey' }).check();
  await expect(page.locator('[data-wizard-shape]')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'A game' })).toBeChecked();
  await page.locator('[data-event-wizard-next]').click();

  // The game: the date, then the place is required; a time is optional.
  await expect(page.getByRole('heading', { name: 'The game' })).toBeVisible();
  await page.locator('[data-event-wizard-date]').fill('2030-06-01');
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText(/Where is it/);
  await page.locator('[data-wizard-place]').fill(`QA Rink ${stamp}`);
  await page.locator('[data-wizard-time]').fill('19:30');
  await page.locator('[data-event-wizard-next]').click();

  // Details: no golf format; the two sides must differ.
  await expect(page.locator('[data-event-wizard="format"]')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Stroke play/ })).toHaveCount(0);
  await page.locator('[data-wizard-side="1"]').fill('Reds');
  await page.locator('[data-wizard-side="2"]').fill('reds');
  await page.locator('[data-event-wizard-next]').click();
  await expect(page.locator('[data-event-wizard-refusal]')).toHaveText(/different names/);
  await page.locator('[data-wizard-side="2"]').fill('Blues');
  await page.locator('[data-event-wizard-next]').click();

  // Review → Publish → the place.
  await expect(page.locator('[data-event-wizard="review"]')).toBeVisible();
  await expect(page.getByText('Reds vs Blues')).toBeVisible();
  await expect(page.getByText('A game')).toBeVisible();
  await page.locator('[data-event-wizard-publish]').click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-event-kind-line]')).toHaveText('A game');
  await expect(page.locator('[data-event-sides-line]')).toHaveText('Reds vs Blues');
  await expect(page.locator('[data-event-place-line]').first()).toContainText(`QA Rink ${stamp}`);
  const eventId = page.url().split('/events/')[1];

  const api = await apiAs('state.json');
  try {
    await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } });
    await api.delete(`/api/sport-events/${eventId}`);
  } finally {
    await api.dispose();
  }
});

/**
 * Events + formats leftovers, PR 12 (221): a team round's own time zone —
 * the wizard's zone select, the start read on the venue's clock, the overview
 * showing the venue time beside the viewer's (the viewer pinned to Los
 * Angeles so the line is deterministic), the view's zone, the instant, the
 * .ics on UTC instants naming the venue time. NEEDS MIGRATION 221 ON THE
 * TARGET (self-skips before).
 */
test.describe('the round zone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('event wizard: a hockey game in Honolulu — the venue time beside the viewer\'s, the zone on the view, the .ics @mobile', async ({ page }) => {
    const admin = adminClient();
    const probe = await admin.from('sport_event_rounds').select('timezone').limit(1);
    test.skip(!!probe.error, 'sport_event_rounds.timezone missing — run migration 221');
    const stamp = Date.now();
    const name = `QA Wizard Zone ${stamp}`;
    await page.goto('/sports/events/new');
    await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-event-wizard-name]').fill(name);
    await page.getByRole('radio', { name: 'Ice Hockey' }).check();
    await page.locator('[data-event-wizard-next]').click();
    await expect(page.getByRole('heading', { name: 'The game' })).toBeVisible();
    await page.locator('[data-event-wizard-date]').fill('2030-06-01');
    await page.locator('[data-wizard-place]').fill(`QA Rink ${stamp}`);
    await page.locator('[data-wizard-time]').fill('19:00');
    await page.locator('[data-wizard-zone]').selectOption('Pacific/Honolulu');
    await page.locator('[data-event-wizard-next]').click();
    await page.locator('[data-wizard-side="1"]').fill('Reds');
    await page.locator('[data-wizard-side="2"]').fill('Blues');
    await page.locator('[data-event-wizard-next]').click();
    await expect(page.locator('[data-event-wizard="review"]')).toBeVisible();
    await page.locator('[data-event-wizard-publish]').click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.locator('[data-event-place-line]').first()).toContainText('7:00 PM HST · 10:00 PM your time', { timeout: 20_000 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
    const eventId = page.url().split('/events/')[1];

    const api = await apiAs('state.json');
    try {
      const view = (await (await api.get(`/api/sport-events/${eventId}`)).json()) as { rounds: Array<{ starts_at: string | null; timezone: string | null }> };
      // PostgREST renders the instant as `+00:00`, not `.000Z` — compare the instant, not the string (prod probe, Sep 17).
      expect(view.rounds[0].timezone).toBe('Pacific/Honolulu');
      expect(Date.parse(view.rounds[0].starts_at ?? '')).toBe(Date.parse('2030-06-02T05:00:00.000Z'));
      const ics = await (await api.get(`/api/sport-events/${eventId}/ics`)).text();
      expect(ics).toContain('DTSTART:20300602T050000Z');
      expect(ics).toContain('Starts 7:00 PM HST');
      await api.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } });
      await api.delete(`/api/sport-events/${eventId}`);
    } finally {
      await api.dispose();
    }
  });
});
