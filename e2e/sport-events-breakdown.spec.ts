import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 9 — breakdowns, at phone width on Chromium
 * and WebKit. Two nine-hole rounds off-catalog (par 4 every hole). Round 1:
 * A 38 (+2: a birdie on 3, a double on 2, a bogey on 7), B 40 (+4); round
 * 2 live with A three holes in. On the overall board A's row opens the
 * window: "All rounds" (two strips, the summed tiles), "This round" is
 * disabled from the overall board; the hardest-holes panel names hole 2
 * (both over par). The API: `?round=all` carries both rounds and the
 * aggregate; `?participant=` narrows to one; a bad round param is a 400.
 */
test('breakdowns: a row opens the window, the strips and tiles, the hardest holes; the API shapes @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, {
      name: `QA Breakdown ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    const { participantId: rowB } = await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // Round 1: A 38 (+2), B 40 (+4); hole 2 is the hardest (A 6, B 5).
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card1 = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    const holes = (list: number[]) => list.map((strokes, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), holes([4, 6, 3, 4, 4, 4, 5, 4, 4]));
    await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), holes([5, 5, 4, 4, 4, 4, 5, 5, 4]));
    await completeRound(s.apiA, eventId, r1);
    // Round 2 live: A three holes in.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const card2 = await readScorecard(s.apiA, view.rounds[1].group_post_id!);
    await scoreHoles(s.apiA, cardRowFor(card2, s.userA.id), holes([4, 4, 3]));

    // The API shapes.
    const all = await s.apiA.get(`${base}/breakdown?round=all`);
    expect(all.ok(), await readErrorBody(all)).toBe(true);
    const data = (await all.json()) as { rounds: Array<{ round: { sequence: number }; players: Array<{ profileId: string; breakdown: { gross: number; toPar: number; front: { strokes: number }; counts: { birdie: number; par: number; bogey: number; doublePlus: number } } }>; hardest: Array<{ hole: number; avgOverPar: number; tracked: number }> }>; overall: { players: Array<{ profileId: string; breakdown: { played: number; gross: number } }>; hardest: Array<{ hole: number }> } | null };
    expect(data.rounds.map(r => r.round.sequence)).toEqual([1, 2]);
    const a1 = data.rounds[0].players.find(p => p.profileId === s.userA.id)!.breakdown;
    expect(a1).toMatchObject({ gross: 38, toPar: 2, front: { strokes: 38 }, counts: { birdie: 1, par: 6, bogey: 1, doublePlus: 1 } });
    expect(data.rounds[0].hardest[0]).toMatchObject({ hole: 2, avgOverPar: 1.5, tracked: 2 });
    expect(data.overall!.players.find(p => p.profileId === s.userA.id)!.breakdown).toMatchObject({ played: 12, gross: 49 });
    expect(data.overall!.hardest[0]).toMatchObject({ hole: 2 });
    const one = await s.apiA.get(`${base}/breakdown?round=${r1}&participant=${rowB}`);
    expect(one.ok(), await readErrorBody(one)).toBe(true);
    const narrowed = (await one.json()) as typeof data;
    expect(narrowed.rounds).toHaveLength(1);
    expect(narrowed.rounds[0].players.map(p => p.profileId)).toEqual([s.userB.id]);
    expect(narrowed.overall).toBeNull();
    expect((await s.apiA.get(`${base}/breakdown?round=nope`)).status()).toBe(400);
    expect((await s.anon.get(`${base}/breakdown`)).status()).toBe(404);

    // The page: the overall board, A's row opens the window on "All rounds" with two strips and the summed tiles; the hardest holes name hole 2.
    await page.goto(`/events/${eventId}?tab=leaderboard&round=overall`);
    await expect(page.locator('[data-overall-board]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-hardest-holes]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-hardest-hole="2"]')).toContainText('+1'); // across all three cards: +2, +1, E
    await page.locator(`[data-overall-row="${s.userA.id}"]`).click();
    const win = page.locator('[data-larger-window="event-breakdown"]');
    await expect(win).toBeVisible();
    await expect(win.locator('[data-breakdown-scope="all"]')).toBeVisible();
    await expect(win.locator('[data-hole-strip]')).toHaveCount(2);
    await expect(win.locator('[data-breakdown-tile="Front"]')).toContainText('49');
    await expect(win.locator('[data-breakdown-tile="Birdies"]')).toContainText('2');
    await expect(win.locator('[data-breakdown-pick="round"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);

    // From round 1's board the window opens on "This round": one strip, round 1's tiles.
    await page.locator(`[data-round-switch="${r1}"]`).click();
    await expect(page.locator(`[data-event-leaderboard="${r1}"]`)).toBeVisible();
    await page.locator(`[data-leaderboard-row="${s.userB.id}"]`).click();
    await expect(win.locator('[data-breakdown-scope="round"]')).toBeVisible();
    await expect(win.locator('[data-hole-strip]')).toHaveCount(1);
    await expect(win.locator('[data-breakdown-tile="Front"]')).toContainText('40');
    await win.locator('[data-breakdown-pick="all"]').click();
    await expect(win.locator('[data-hole-strip]')).toHaveCount(2);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
