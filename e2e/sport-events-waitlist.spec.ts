import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, inviteAndAccept, openEventSession, readView } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 12 — the waitlist polish, at phone width on
 * Chromium and WebKit. Capacity 1 and the host plays: B accepts onto the
 * waitlist at #1. B's page says "You're next"; the header reads
 * "Waitlisted #1 · you're next"; B cannot reorder; an organizer's move to
 * a bad place is refused by name; A promotes B now from the Players tab —
 * the field goes one over the capacity; a promoted row can no longer be
 * moved.
 */
test('waitlist: "you\'re next", promote now from the roster, reorder refusals @mobile', async ({ page, browser }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Waitlist ${s.stamp}`, publish: true, capacity: 1, round: { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const { participantId: rowB } = await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // B is waitlisted #1 with nobody ahead; the roster hides others' queue places from a player but B sees their own.
    const asB = await readView(s.apiB, eventId);
    expect(asB.viewer).toMatchObject({ participant_status: 'waitlisted', waitlist_ahead: 0 });
    expect(asB.counts).toMatchObject({ playing: 1, waitlisted: 1 });
    expect(asB.participants.find(p => p.id === rowB)).toMatchObject({ status: 'waitlisted', waitlist_position: 1 });

    // B's page: the header and the roster row.
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}?tab=players`);
      await expect(pageB.locator('[data-event-waitlisted="1"]').first()).toContainText("you're next", { timeout: 20_000 }); // the header and the Players tab both carry the join control
      await expect(pageB.locator('[data-waitlist-self]')).toHaveText("You're next");
      await expect(pageB.locator('[data-waitlist-promote]')).toHaveCount(0);
    } finally {
      await ctxB.close();
    }

    // The API: B cannot reorder; a bad place is refused by name; the organizer's move to the same place is a no-op.
    expect((await s.apiB.patch(`${base}/participants/${rowB}`, { data: { waitlist_position: 1 } })).status()).toBe(403);
    const bad = await s.apiA.patch(`${base}/participants/${rowB}`, { data: { waitlist_position: 0 } });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain('waitlist_position');
    const same = await s.apiA.patch(`${base}/participants/${rowB}`, { data: { waitlist_position: 1 } });
    expect(same.ok(), await readErrorBody(same)).toBe(true);
    expect(((await same.json()) as { participant: { waitlist_position: number } }).participant.waitlist_position).toBe(1);

    // A promotes B now from the Players tab: accepted, the field one over the capacity.
    await page.goto(`/events/${eventId}?tab=players`);
    await expect(page.locator(`[data-waitlist-promote="${s.userB.id}"]`)).toBeVisible({ timeout: 20_000 });
    await page.locator(`[data-waitlist-promote="${s.userB.id}"]`).click();
    await expect(page.locator(`[data-event-player="${s.userB.id}"][data-event-player-status="accepted"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('2 of 1 playing')).toBeVisible();
    const after = await readView(s.apiA, eventId);
    expect(after.counts).toMatchObject({ playing: 2, waitlisted: 0 });
    // A promoted row is no longer on the queue.
    expect((await s.apiA.patch(`${base}/participants/${rowB}`, { data: { waitlist_position: 1 } })).status()).toBe(409);
    expect((await s.apiA.post(`${base}/participants/${rowB}`, { data: { action: 'promote' } })).status()).toBe(409);
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
