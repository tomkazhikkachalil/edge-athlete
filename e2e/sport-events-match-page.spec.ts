import { test, expect } from '@playwright/test';
import { adminClient } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, createEvent, inviteAndAccept, openEventSession, readScorecard, readView, scoreHoles, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 3, PR 7 — the Matches tab at phone width on
 * Chromium and WebKit. NEEDS MIGRATION 212 ON THE TARGET (self-skips).
 * A hosts a nine-hole singles gross match, draws A vs B and starts it.
 * The page: the Matches tab replaces Leaderboard (an old `?tab=leaderboard`
 * deep link lands on the overview); the row reads "Not started"; the
 * Complete button waits on the open match; the organizer's Decide sheet
 * opens and closes; A 4s vs B 5s over five holes → the row reads "wins
 * 5&4" with the winner bold; Complete → the confirm's match wording → the
 * event is final.
 */
test('the Matches tab: the row, the Decide sheet, the complete confirm @mobile', async ({ page }) => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Match Page ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, roundId, [{ members: [aId, bId] }]);
    const live = await startRound(s.apiA, eventId, roundId, '2030-06-01');
    const groupPostId = live.rounds[0].group_post_id as string;

    // The tab strip: Matches, no Leaderboard; the old deep link lands on the overview.
    await page.goto(`/events/${eventId}?tab=leaderboard`);
    await expect(page.locator('[data-event-tab="matches"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-event-tab="leaderboard"]')).toHaveCount(0);
    await expect(page.locator('[data-event-tab="overview"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-event-format-line]')).toHaveText('Match play · Singles · Gross');

    // The row: not started; the complete button waits on the open match; the Decide sheet.
    await page.locator('[data-event-tab="matches"]').click();
    await expect(page.locator(`[data-event-matches="${roundId}"]`)).toBeVisible({ timeout: 20_000 });
    const row = page.locator('[data-match-row]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-match-summary]')).toHaveText('Not started');
    await expect(page.locator('[data-complete-round]')).toBeDisabled();
    await expect(page.locator('[data-matches-undecided-note]')).toContainText('1 match is still open: Match 1');
    await row.locator('[data-match-decide]').click();
    const sheet = page.locator('[data-larger-window="match-decide"]');
    await expect(sheet.locator('[data-match-decide-sheet]')).toBeVisible();
    await expect(sheet.locator('[data-decide-side]')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // A 4s vs B 5s over five holes → A wins 5&4; the winner bold; complete from the tab.
    const card = await readScorecard(s.apiA, groupPostId);
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), [1, 2, 3, 4, 5].map(h => ({ hole_number: h, strokes: 4 })));
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), [1, 2, 3, 4, 5].map(h => ({ hole_number: h, strokes: 5 })));
    await page.reload();
    await page.locator('[data-event-tab="matches"]').click();
    await expect(page.locator('[data-match-row] [data-match-summary]')).toContainText('wins 5&4', { timeout: 20_000 });
    await expect(page.locator('[data-match-row][data-match-status="completed"]')).toHaveCount(1);
    await expect(page.locator('[data-match-row] [data-match-side="1"]')).toHaveClass(/font-bold/);
    await expect(page.locator('[data-match-row] [data-match-side="2"]')).not.toHaveClass(/font-bold/);
    await expect(page.locator('[data-match-row] [data-match-decide]')).toHaveCount(0);
    await expect(page.locator('[data-complete-round]')).toBeEnabled();
    await page.locator('[data-complete-round]').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Complete the event?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Every match must be decided');
    await confirm.getByRole('button', { name: 'Complete' }).click();
    await expect(page.locator('[data-matches-final-note]')).toHaveText('The event is final.', { timeout: 20_000 });
    const after = await readView(s.apiA, eventId);
    expect(after.event.status).toBe('completed');
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
