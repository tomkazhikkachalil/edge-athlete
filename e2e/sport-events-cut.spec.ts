import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, finalizeCard, inviteAndAccept, openEventSession, readScorecard, readView, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 8 — the cut and the round names (207), at
 * phone width on Chromium and WebKit. NEEDS MIGRATION 207 ON THE TARGET.
 * A hosts two nine-hole rounds with a cut after round 1 (top 1). Round 1:
 * A 36, B 45 → the standing decides: A made it, B missed. The overall
 * board carries the cut line and B below it; the cut can no longer change;
 * round 2 is named "Final" and, once started, its scorecard holds A only.
 * The page: the Overview's cut line and the Format settings window; the
 * header names the round.
 */
test('the cut: set while open, decided by round 1, the missed-cut set out of round 2; round names @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, {
      name: `QA Cut ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // The cut: strict — an unknown key and a bad round are refused by name; the plan lands on the view.
    expect(await (await s.apiA.patch(base, { data: { format_config: { cut: { after_round: 2, top_n: 1 } } } })).text()).toContain('format_config.cut.after_round');
    expect(await (await s.apiA.patch(base, { data: { format_config: { stableford: true } } })).text()).toContain('Unknown field: format_config.stableford');
    const set = await s.apiA.patch(base, { data: { format_config: { cut: { after_round: 1, top_n: 1 } } } });
    expect(set.ok(), await readErrorBody(set)).toBe(true);
    view = await readView(s.apiA, eventId);
    expect(view.event.format_config).toEqual({ cut: { after_round: 1, top_n: 1 } });

    // Round 2 is named while scheduled.
    const named = await s.apiA.put(`${base}/rounds/${r2}`, { data: { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1, name: 'Final' } });
    expect(named.ok(), await readErrorBody(named)).toBe(true);
    expect(((await named.json()) as { rounds: Array<{ name: string | null }> }).rounds[1].name).toBe('Final');

    // Round 1: A 36, B 45 → complete → the standing decides.
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card1 = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    const nine = (strokes: number) => Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), nine(4));
    await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), nine(5));
    await completeRound(s.apiA, eventId, r1);
    const overall = (await (await s.apiA.get(`${base}/leaderboard`)).json()) as { board: { cutLine: { afterRound: number; madeCut: number; missed: number; score: number | null } | null; rows: Array<{ profileId: string; rank: number | null; madeCut: boolean | null }> } };
    expect(overall.board.cutLine).toEqual({ afterRound: 1, score: 36, madeCut: 1, missed: 1 });
    expect(overall.board.rows.map(r => [r.profileId, r.rank, r.madeCut])).toEqual([[s.userA.id, 1, true], [s.userB.id, 2, false]]);
    // The cut can no longer change while it is live; the event-level edit is still closed.
    const late = await s.apiA.patch(base, { data: { format_config: { cut: { after_round: 1, top_n: 2 } } } });
    expect(late.status()).toBe(409);
    expect(((await late.json()) as { reason: string }).reason).toBe('cut_already_passed');
    expect((await s.apiA.patch(base, { data: { name: 'Renamed' } })).status()).toBe(409);

    // Round 2 starts with A only — B missed the cut and is not minted into it.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const card2 = await readScorecard(s.apiA, view.rounds[1].group_post_id!);
    expect(card2.participants.map(p => p.participant.profile_id)).toEqual([s.userA.id]);

    // The page: the header names the round; the Overview shows the cut and the settings window reads it, locked.
    await page.goto(`/events/${eventId}`);
    await expect(page.locator('[data-event-round-line]')).toHaveText(/Round 2 of 2 · Final ·/, { timeout: 20_000 });
    await expect(page.locator('[data-event-cut-line]')).toHaveText('Cut after round 1 · top 1');
    await page.locator('[data-event-format-open]').click();
    const win = page.locator('[data-larger-window="event-format"]');
    await expect(win).toBeVisible();
    await expect(win.locator('[data-cut-locked]')).toBeVisible();
    await expect(win.locator('[data-cut-value]')).toHaveValue('1');
    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);
    // The overall board: the cut line and B below it.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=overall`);
    await expect(page.locator('[data-overall-board]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-cut-line]')).toContainText('Cut after round 1 · 36 · 1 made it · 1 missed');
    await expect(page.locator(`[data-overall-row="${s.userB.id}"] [data-missed-cut]`)).toBeVisible();

    // Phase 3 (the round's own field): round 2's field is A alone — once A's card is
    // final the round completes WITHOUT the override (the roster is never the
    // measure), and the event follows.
    await scoreHoles(s.apiA, cardRowFor(card2, s.userA.id), nine(4));
    await finalizeCard(s.apiA, eventId, cardRowFor(card2, s.userA.id));
    const done = await completeRound(s.apiA, eventId, r2, false);
    expect(done.event.status).toBe('completed');
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
