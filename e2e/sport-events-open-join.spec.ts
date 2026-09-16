import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, openEventSession, readView } from './helpers/sport-events';

/**
 * Events program, phase 4, PR 4 — open joining, at phone width on Chromium
 * and WebKit. NEEDS MIGRATION 214 ON THE TARGET (self-skips before). A
 * public event under `join_mode: 'open'` with a field of one: B joins
 * with one tap from the header and is in; C (when the four QA users are
 * minted) joins and is waitlisted #1; a removed B may not rejoin (403); a
 * request-mode event refuses the join door (403); a stranger's private
 * open event is a 404; a new event created without a visibility or a
 * joining is PUBLIC and open.
 */
test('open joining: one-tap Join, the waitlist, a removed row, request mode, the public defaults @mobile', async ({ page, browser }) => {
  const s = await openEventSession();
  const admin = adminClient();
  const probe = await admin.from('sport_events').select('self_entry').limit(1);
  test.skip(!!probe.error, 'sport_events.self_entry missing — run migration 214');
  let eventId: string | null = null;
  let requestId: string | null = null;
  let privateId: string | null = null;
  let defaultsId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Open Join ${s.stamp}`, visibility: 'public', join_mode: 'open', publish: true, capacity: 1, host_plays: false, round: { scheduled_on: '2030-06-01', course_name: 'QA Open Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    expect(view.event).toMatchObject({ visibility: 'public' });

    // B: one tap from the header at 390 → "You're in".
    const ctxB = await browser.newContext({ storageState: 'e2e/.auth/state-b.json' });
    try {
      const pageB = await ctxB.newPage();
      await pageB.goto(`/events/${eventId}`);
      const join = pageB.locator('[data-event-join="join"]').first();
      await expect(join).toBeVisible({ timeout: 20_000 });
      await join.click();
      await expect(pageB.locator('[data-event-join="in"]').first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await ctxB.close();
    }
    let after = await readView(s.apiB, eventId);
    expect(after.viewer).toMatchObject({ participant_status: 'accepted', playing: true });
    expect(after.counts.playing).toBe(1);
    // Twice → already in.
    expect((await s.apiB.post(`/api/sport-events/${eventId}/participants/join`, { data: {} })).status()).toBe(409);

    // C: the field is full → waitlisted #1 (four QA users only).
    if (s.apiC) {
      const joined = await s.apiC.post(`/api/sport-events/${eventId}/participants/join`, { data: {} });
      expect(joined.status(), await readErrorBody(joined)).toBe(200);
      const asC = await readView(s.apiC, eventId);
      expect(asC.viewer).toMatchObject({ participant_status: 'waitlisted' });
      expect(asC.participants.find(p => p.profile_id === s.userC!.id)?.waitlist_position).toBe(1);
    }

    // A removes B; B may not rejoin.
    after = await readView(s.apiA, eventId);
    const bRow = after.participants.find(p => p.profile_id === s.userB.id)!;
    expect((await s.apiA.post(`/api/sport-events/${eventId}/participants/${bRow.id}`, { data: { action: 'remove' } })).ok()).toBe(true);
    const rejoin = await s.apiB.post(`/api/sport-events/${eventId}/participants/join`, { data: {} });
    expect(rejoin.status()).toBe(403);

    // Request mode refuses the join door; a private open event is a 404 to a stranger.
    const req = await createEvent(s.apiA, { name: `QA Open Req ${s.stamp}`, visibility: 'public', join_mode: 'request', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Open Links' } });
    requestId = req.event.id;
    expect((await s.apiB.post(`/api/sport-events/${requestId}/participants/join`, { data: {} })).status()).toBe(403);
    const priv = await createEvent(s.apiA, { name: `QA Open Private ${s.stamp}`, visibility: 'private', join_mode: 'open', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Open Links' } });
    privateId = priv.event.id;
    expect((await s.apiB.post(`/api/sport-events/${privateId}/participants/join`, { data: {} })).status()).toBe(404);

    // The defaults: nothing said → public and open.
    const created = await s.apiA.post('/api/sport-events', { data: { name: `QA Open Defaults ${s.stamp}`, round: { scheduled_on: '2030-06-01', course_name: 'QA Open Links' } } });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const d = (await created.json()) as { event: { id: string; visibility: string; join_mode: string } };
    defaultsId = d.event.id;
    expect(d.event).toMatchObject({ visibility: 'public', join_mode: 'open' });
    await page.goto(`/events/${defaultsId}`);
    await expect(page.locator('[data-event-place]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Open to everyone').first()).toBeVisible();
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await cleanupEvent(s.apiA, requestId);
    await cleanupEvent(s.apiA, privateId);
    await cleanupEvent(s.apiA, defaultsId);
    await s.dispose();
  }
});
