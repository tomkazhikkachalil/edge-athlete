import { test, expect } from '@playwright/test';
import { cleanupEvent, createEvent, openEventSession, readView } from './helpers/sport-events';

/**
 * Events program, phase 2b (B2) — a sport event round on the calendar. A
 * hosts an event next month and invites B; before accepting, B's calendar
 * carries the round as a needs-reply item; after accepting, the agenda at
 * 390 lists it and a tap opens the event's page on that round. The API carries the item with
 * `kind: 'sport_event'`. Tagged @mobile on Chromium and WebKit.
 */
test('calendar: an event round appears on the day, dashed while invited, and taps through to the event @mobile', async ({ page }) => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    // The 15th of NEXT month: one "Next" tap from the calendar's default month,
    // and the agenda view (the phone's list) shows the whole month.
    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
    const day = target.toISOString().slice(0, 10);
    const view = await createEvent(s.apiA, { name: `QA Cal ${s.stamp}`, publish: true, round: { scheduled_on: day, course_name: 'QA Cal Links', holes: 18 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;

    // The API: the host sees the round on the day (kind sport_event, accepted, all-day).
    const range = `?from=${new Date(target.getTime() - 20 * 86_400_000).toISOString()}&to=${new Date(target.getTime() + 20 * 86_400_000).toISOString()}`;
    const asA = await s.apiA.get(`/api/calendar/events${range}`);
    expect(asA.ok()).toBe(true);
    const itemsA = ((await asA.json()) as { events: Array<{ id: string; kind?: string; my_status: string | null; all_day: boolean; starts_at: string; sport_event?: { event_id: string; round_id: string; tab: string } }> }).events;
    const mine = itemsA.find(e => e.id === `sport_event:${roundId}`);
    expect(mine).toBeTruthy();
    expect(mine).toMatchObject({ kind: 'sport_event', my_status: 'accepted', all_day: true, starts_at: `${day}T00:00:00.000Z`, sport_event: { event_id: eventId, round_id: roundId, tab: 'schedule' } });

    // B is invited: the item is there, dashed (invited); a stranger has nothing.
    const invited = await s.apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [s.userB.id] } });
    expect(invited.ok()).toBe(true);
    const asB = await s.apiB.get(`/api/calendar/events${range}`);
    const itemsB = ((await asB.json()) as { events: Array<{ id: string; my_status: string | null }> }).events;
    expect(itemsB.find(e => e.id === `sport_event:${roundId}`)).toMatchObject({ my_status: 'invited' });

    // B accepts and opens the calendar at 390: next month, the agenda (the
    // phone's list — the month grid shows dots there), the chip, a tap
    // opens the event on that round.
    const bView = await readView(s.apiB, eventId);
    const accepted = await s.apiB.post(`/api/sport-events/${eventId}/participants/${bView.viewer.participant_id}`, { data: { action: 'accept' } });
    expect(accepted.ok()).toBe(true);
    await page.goto('/calendar');
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Agenda' }).click();
    const chip = page.getByRole('button', { name: new RegExp(`QA Cal ${s.stamp}`) }).first();
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}\\?tab=schedule&round=${roundId}`), { timeout: 20_000 });
    await expect(page.locator('[data-event-status-chip]')).toBeVisible({ timeout: 20_000 });
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
