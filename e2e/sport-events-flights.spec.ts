import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 6 — flights, at phone width on Chromium and
 * WebKit. A hosts, B plays. The organizer opens the Flights window from
 * the Players tab, puts A in flight A and B in flight B, saves; the rows
 * carry the flight; the leaderboard shows the flight segment and "B"
 * ranks B first within the flight (the `?flight=` deep link). The API:
 * B's own PATCH of a flight is refused, an unknown field is refused by
 * name, a plan naming a stranger is refused by entry, and the round
 * board's `?flight=B` carries only B, ranked 1.
 */
test('flights: assign from the window, the chip on the roster, the segment and ?flight= on the board; the API refusals @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, { name: `QA Flights ${s.stamp}`, publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const { participantId: rowB, hostRowId } = await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // The window: both players, no index yet (the auto-flight is for indexed fields); assign by hand and save.
    await page.goto(`/events/${eventId}?tab=players`);
    await expect(page.getByRole('heading', { name: `QA Flights ${s.stamp}` })).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-event-flights-open]').click();
    const win = page.locator('[data-larger-window="event-flights"]');
    await expect(win).toBeVisible();
    await expect(win.locator('[data-flights-row]')).toHaveCount(2);
    await win.locator(`[data-flight-input="${s.userA.id}"]`).fill('A');
    await win.locator(`[data-flight-input="${s.userB.id}"]`).fill('B');
    await win.locator('[data-flights-save]').click();
    await expect(win).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(`[data-event-player="${s.userA.id}"] [data-event-player-flight="A"]`)).toBeVisible();
    await expect(page.locator(`[data-event-player="${s.userB.id}"] [data-event-player-flight="B"]`)).toBeVisible();

    // The board: the segment lists both flights; "B" ranks within the flight and writes the deep link.
    view = await startRound(s.apiA, eventId, roundId, '2030-06-01');
    const card = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    await scoreHoles(s.apiA, cardRowFor(card, s.userA.id), [{ hole_number: 1, strokes: 4 }]);
    await scoreHoles(s.apiB, cardRowFor(card, s.userB.id), [{ hole_number: 1, strokes: 5 }]);
    await page.getByRole('tab', { name: 'Leaderboard' }).click();
    await expect(page.locator('[data-flight-segment]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-flight="B"]')).toBeVisible();
    await page.locator('[data-flight="B"]').click();
    await expect(page).toHaveURL(/flight=B/);
    await expect(page.locator('[data-leaderboard-row]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(`[data-leaderboard-row="${s.userB.id}"]`)).toContainText('1');
    await page.locator('[data-flight="all"]').click();
    await expect(page.locator('[data-leaderboard-row]')).toHaveCount(2, { timeout: 15_000 });

    // The API: a player cannot set a flight; an unknown field and a stranger in the plan are refused by name; ?flight= ranks within the flight.
    expect((await s.apiB.patch(`${base}/participants/${rowB}`, { data: { flight: 'C' } })).status()).toBe(403);
    const typo = await s.apiA.patch(`${base}/participants/${rowB}`, { data: { flite: 'C' } });
    expect(typo.status()).toBe(400);
    expect(await typo.text()).toContain('Unknown field');
    const stranger = await s.apiA.put(`${base}/flights`, { data: { assignments: [{ participant_id: '00000000-0000-4000-8000-000000000000', flight: 'A' }] } });
    expect(stranger.status()).toBe(400);
    expect(await stranger.text()).toContain('assignments[0].participant_id');
    const onlyB = await s.apiA.get(`${base}/rounds/${roundId}/leaderboard?flight=B`);
    expect(onlyB.ok(), await readErrorBody(onlyB)).toBe(true);
    const board = (await onlyB.json()) as { flight: string | null; flights: string[]; rows: Array<{ profileId: string; rank: number | null; flight: string | null }> };
    expect(board).toMatchObject({ flight: 'B', flights: ['A', 'B'] });
    expect(board.rows.map(r => [r.profileId, r.rank, r.flight])).toEqual([[s.userB.id, 1, 'B']]);
    const patched = await s.apiA.patch(`${base}/participants/${hostRowId}`, { data: { flight: '' } });
    expect(patched.ok(), await readErrorBody(patched)).toBe(true);
    expect(((await patched.json()) as { participant: { flight: string | null } }).participant.flight).toBeNull();
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
