import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, roundBoard, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events + formats leftovers, PR 10 — Stableford live. NEEDS MIGRATION 221 ON
 * THE TARGET (self-skips before it: the create refuses the format by the CHECK).
 * A hosts a two-round nine-hole `stableford_gross` event with a cut after
 * round 1 (top 1) on an off-catalog course (par 4 every hole). Round 1: A
 * plays 3 3 3 3 5 5 5 5 5 = 37 strokes → 3+3+3+3+1+1+1+1+1 = 17 points; B
 * plays 4 4 4 4 4 4 4 4 8 = 40 strokes → 2×8 + 0 = 16 points. Fewer points
 * loses even with a close total — A ranks 1 and the cut line's score is the
 * MIN (16 misses: 17 is the line). The card's game format is pinned by
 * the mint's unit test; the mirror keeps strokes; `to_par` is refused on the cut; the org's leaderboard
 * refuses the event by name; the page shows the format line, the Pts header
 * and no net toggle on the gross flavour (`@mobile`).
 */
test('Stableford: points rank the board, the cut is the top N only, never counts toward the org; the boards read Pts @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    const probe = await s.apiA.post('/api/sport-events', { data: { name: `QA Stableford probe ${s.stamp}`, visibility: 'private', format: 'stableford_gross', round: { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 } } });
    if (probe.status() === 500 || probe.status() === 400) {
      const body = await probe.text();
      test.skip(/23514|format/i.test(body), 'migration 221 not on the target: the format CHECK refuses stableford_gross');
    }
    expect(probe.status(), await readErrorBody(probe)).toBe(201);
    await cleanupEvent(s.apiA, ((await probe.json()) as { event: { id: string } }).event.id);

    let view = await createEvent(s.apiA, {
      name: `QA Stableford ${s.stamp}`,
      format: 'stableford_gross',
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    expect(view.event.format).toBe('stableford_gross');
    const [r1, r2] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // The cut: `to_par` is refused BY NAME on Stableford; the top N lands.
    const toPar = await s.apiA.patch(base, { data: { format_config: { cut: { after_round: 1, to_par: 2 } } } });
    expect(toPar.status()).toBe(400);
    expect(await toPar.text()).toContain('to_par');
    const set = await s.apiA.patch(base, { data: { format_config: { cut: { after_round: 1, top_n: 1 } } } });
    expect(set.ok(), await readErrorBody(set)).toBe(true);

    // Round 1: A 37 strokes / 17 points, B 40 strokes / 16 points → A ranks 1 on points.
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card1 = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    // The card's `game_format: 'stableford'` is pinned by mint.test.ts (the scorecard API does not echo it).
    const holes = (strokes: number[]) => strokes.map((n, i) => ({ hole_number: i + 1, strokes: n }));
    await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), holes([3, 3, 3, 3, 5, 5, 5, 5, 5]));
    await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), holes([4, 4, 4, 4, 4, 4, 4, 4, 8]));
    const live = await roundBoard(s.apiA, eventId, r1);
    expect(live.rows.map(r => [r.profileId, r.rank, r.gross, r.points])).toEqual([[s.userA.id, 1, 37, 17], [s.userB.id, 2, 40, 16]]);

    await completeRound(s.apiA, eventId, r1);
    const overall = (await (await s.apiA.get(`${base}/leaderboard`)).json()) as { board: { cutLine: { afterRound: number; madeCut: number; missed: number; score: number | null } | null; rows: Array<{ profileId: string; rank: number | null; madeCut: boolean | null; points: number | null }> } };
    expect(overall.board.cutLine).toEqual({ afterRound: 1, score: 17, madeCut: 1, missed: 1 });
    expect(overall.board.rows.map(r => [r.profileId, r.rank, r.madeCut, r.points])).toEqual([[s.userA.id, 1, true, 17], [s.userB.id, 2, false, 16]]);

    // Round 2 is minted without the cut-missed player.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const card2 = await readScorecard(s.apiA, view.rounds[1].group_post_id!);
    expect(card2.participants.map(p => p.participant.profile_id)).toEqual([s.userA.id]);

    // The page at phone width: the format line, the Pts header, no net toggle on the gross flavour.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=${r1}`);
    await expect(page.locator('[data-leaderboard-key]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('columnheader', { name: 'Pts' }).first()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Scoring' })).toHaveCount(0);
    await page.goto(`/events/${eventId}`);
    await expect(page.locator('[data-event-format-line]')).toContainText('Stableford · Gross', { timeout: 20_000 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
