import { test, expect } from '@playwright/test';
import { createEvent, inviteAndAccept, openEventSession, cleanupEvent } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 4 — the event page for N rounds, at phone
 * width on Chromium and WebKit. A hosts a two-round tournament, B plays.
 * The `?round=overall` deep link lands on the overall board with the
 * switcher's Overall pill pressed; the header reads "Round 1 of 2"; the
 * schedule's card starts round 1 through the confirm; the header's primary
 * action becomes "Complete round 1"; the groups tab lets round 2 be
 * regrouped while round 1 is live and locks round 1; the scorecard tab
 * follows the live round; completing round 1 from the header leaves the
 * event live and the header offers "Start round 2"; the add / edit window
 * appends round 3 and the schedule shows three cards.
 */
test('tournament page: the switcher, the deep link, start / complete a round from the page, groups per round, add a round @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, {
      name: `QA Tourney ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);

    // The deep link: the overall board with the Overall pill pressed; the header names the round in focus.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=overall`);
    await expect(page.getByRole('heading', { name: `QA Tourney ${s.stamp}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-event-round-line]')).toHaveText(/Round 1 of 2 · Sat, Jun 1, 2030 · QA Links/);
    await expect(page.locator('[data-event-round-next]')).toHaveText(/Next: Round 2/);
    await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-round-switch="overall"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-overall-board]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-overall-board] th', { hasText: 'R2' })).toBeVisible();
    // Switching to round 1's board writes the deep link.
    await page.locator(`[data-round-switch="${r1}"]`).click();
    await expect(page.locator(`[data-event-leaderboard="${r1}"]`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`round=${r1}`));

    // The schedule: two cards, both scheduled; only round 1 can start; Start round 1 through the confirm.
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await expect(page.locator('[data-event-round]')).toHaveCount(2);
    await expect(page.locator(`[data-round-actions="${r1}"] [data-round-action="start"]`)).toBeVisible();
    await expect(page.locator(`[data-round-actions="${r2}"] [data-round-action="start"]`)).toHaveCount(0);
    await page.locator(`[data-round-actions="${r1}"] [data-round-action="start"]`).click();
    await expect(page.getByRole('dialog')).toContainText('Start round 1?');
    await page.getByRole('dialog').getByRole('button', { name: 'Start round 1' }).click();
    await expect(page.locator('[data-event-status-chip]')).toHaveText(/Live/, { timeout: 15_000 });
    await expect(page.locator(`[data-event-round="${r1}"] [data-round-chip="live"]`)).toBeVisible();
    await expect(page.locator(`[data-event-round="${r2}"] [data-round-chip="scheduled"]`)).toBeVisible();
    await expect(page.locator('[data-event-round-line]')).toHaveText(/Round 1 of 2 .* · live/);
    await expect(page.locator('[data-event-action="completed"]')).toHaveText('Complete round 1');

    // Groups: round 2 is editable while round 1 is live; round 1 is locked.
    await page.getByRole('tab', { name: 'Groups' }).click();
    await page.locator(`[data-round-switch="${r2}"]`).click();
    await expect(page.locator(`[data-event-groups-editor="${r2}"] [data-groups-add]`)).toBeVisible();
    await page.locator(`[data-round-switch="${r1}"]`).click();
    await expect(page.locator(`[data-event-groups-editor="${r1}"] [data-groups-locked]`)).toBeVisible();

    // The scorecard tab follows the live round (the only minted one: no switcher).
    await page.getByRole('tab', { name: 'Scorecard' }).click();
    await expect(page.locator(`[data-event-scorecard-tab="${r1}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-complete-event]')).toHaveText('Complete round 1');

    // Complete round 1 from the header: the event stays live; the header offers Start round 2.
    await page.locator('[data-event-action="completed"]').click();
    await expect(page.getByRole('dialog')).toContainText('Complete round 1?');
    await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.locator('[data-event-action="live"]')).toHaveText('Start round 2', { timeout: 15_000 });
    await expect(page.locator('[data-event-status-chip]')).toHaveText(/Live/);
    await expect(page.locator('[data-event-round-line]')).toHaveText(/Round 2 of 2/);

    // Add a round from the schedule: the window appends round 3.
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.locator('[data-round-add]').click();
    const win = page.locator('[data-larger-window="round-edit"]');
    await expect(win).toBeVisible();
    await win.locator('[data-round-date]').fill('2030-06-03');
    await win.locator('[data-course-search]').fill('QA Third');
    await win.locator('[data-course-typed]').click();
    await expect(win.locator('[data-course-picked="typed"]')).toBeVisible();
    await win.locator('[data-round-edit-save]').click();
    await expect(page.locator('[data-event-round]')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('[data-event-round]').nth(2)).toContainText('Round 3');
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
