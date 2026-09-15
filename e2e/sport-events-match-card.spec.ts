import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound } from './helpers/sport-events';

/**
 * Events program, phase 3, PR 8 — the group card's MatchStrip at phone
 * width on Chromium and WebKit. NEEDS MIGRATION 212 ON THE TARGET
 * (self-skips). A hosts a nine-hole singles gross match, A vs B, and
 * opens the round's place: two columns, the back link to the Matches tab,
 * the strip "Not started", never a Submit button. A scores holes 1 and 2
 * through the grid, B through the API → "All square thru 2"; B concedes
 * hole 3 through the API → "1 UP thru 3" for A; A selects hole 4 and
 * concedes it from the strip → "All square thru 4" and the hole reads
 * conceded; holes 5–9 halved → all square after nine → the extra-hole
 * editor: A 4, B 5 → "wins · 10 holes".
 */
test('the group card on a match round: the columns, the strip, a concession, the extra-hole editor @mobile', async ({ page }) => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_event_matches').select('id').limit(1);
  test.skip(!!probe.error, 'sport_event_matches missing — run migration 212');
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Match Card ${s.stamp}`, publish: true, format: 'match_gross', format_config: { match: { sides: 'singles' } }, round: { scheduled_on: '2030-06-01', course_name: 'QA Match Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: bId, hostRowId: aId } = await inviteAndAccept(s, eventId);
    await setGroups(s.apiA, eventId, roundId, [{ members: [aId, bId] }]);
    const live = await startRound(s.apiA, eventId, roundId, '2030-06-01');
    const gp = live.rounds[0].group_post_id as string;
    const matchId = ((await (await s.apiA.get(`/api/sport-events/${eventId}/matches`)).json()) as { matches: Array<{ id: string; version: number }> }).matches[0].id;

    await page.goto(`/live/${gp}`);
    await expect(page.locator('[data-group-score-card]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-gsc-col]')).toHaveCount(2);
    await expect(page.locator('[data-live-back]')).toHaveAttribute('href', `/events/${eventId}?tab=matches`);
    await expect(page.locator('[data-match-strip-summary]')).toHaveText('Not started');
    await expect(page.locator('[data-gsc-submit]')).toHaveCount(0);

    // Holes 1 and 2: A through the grid (the wheel rests on par), B through the API.
    await page.locator(`[data-gsc-cell="${s.userA.id}:1"]`).click();
    await page.locator('[data-gsc-save]').click();
    await expect(page.locator(`[data-gsc-cell="${s.userA.id}:1"]`)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 15_000 });
    await page.locator('[data-gsc-save]').click();
    await expect(page.locator(`[data-gsc-cell="${s.userA.id}:2"]`)).toHaveAttribute('data-gsc-state', 'saved', { timeout: 15_000 });
    await page.locator('[data-gsc-editor]').getByRole('button', { name: 'Close the editor' }).click();
    const card = await readScorecard(s.apiA, gp);
    const bRow = cardRowFor(card, s.userB.id);
    await scoreHoles(s.apiB, bRow, [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }]);
    await page.reload();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText('All square thru 2', { timeout: 20_000 });

    // B concedes hole 3 (the API); A's strip reads 1 UP thru 3.
    const c3 = await s.apiB.post(`/api/sport-events/${eventId}/matches/${matchId}/concede`, { data: { hole: 3, side: 2, version: 0 } });
    expect(c3.status(), await readErrorBody(c3)).toBe(200);
    await page.reload();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText(/1 UP thru 3$/, { timeout: 20_000 });
    await expect(page.locator('[data-gsc-hole="3"][data-gsc-conceded]')).toHaveCount(1);

    // A selects hole 4 and concedes it from the strip → all square thru 4.
    await page.locator(`[data-gsc-cell="${s.userA.id}:4"]`).click();
    await expect(page.locator('[data-gsc-concede="4"]')).toBeVisible();
    await page.locator('[data-gsc-concede="4"]').click();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText('All square thru 4', { timeout: 20_000 });
    await expect(page.locator('[data-gsc-hole="4"][data-gsc-conceded]')).toHaveCount(1);

    // Holes 5–9 halved → all square after nine → the extra-hole editor decides.
    const rest = [5, 6, 7, 8, 9].map(h => ({ hole_number: h, strokes: 4 }));
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), rest);
    await scoreHoles(s.apiB, bRow, rest);
    await page.reload();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText('All square after 9 · extra holes', { timeout: 20_000 });
    const editor = page.locator('[data-extra-hole-editor="1"]');
    await expect(editor).toBeVisible();
    await expect(editor.locator('[data-extra-hole-wheel]')).toHaveCount(2);
    const bWheel = editor.locator(`[data-extra-hole-wheel="${bId}"] [role="spinbutton"]`);
    await bWheel.focus();
    await bWheel.press('5');
    await expect(bWheel).toHaveAttribute('aria-valuenow', '5');
    await editor.locator('[data-extra-hole-save]').click();
    await expect(page.locator('[data-match-strip-summary]')).toHaveText(/wins · 10 holes$/, { timeout: 20_000 });
    await expect(page.locator('[data-match-strip-status="completed"]')).toBeVisible();
    await expect(page.locator('[data-extra-hole-editor]')).toHaveCount(0);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
