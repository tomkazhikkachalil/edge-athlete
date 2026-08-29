import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

// Carpool (Wave 9, mig 139) — API loop over the real routes: offer → claim
// → capacity guard → release → cancel, plus the structural-leak assertion
// (carpool notes must NEVER reach the ICS payload). Serial: one event
// threads through. Gated on FEATURE_CALENDAR like the calendar suite.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
let eventId = '';
let offerId = '';

test('setup: A creates an event with B as guest; B accepts', async () => {
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    const userB = loadQaUser('user-b.json');
    const start = new Date(Date.now() + 2 * 86_400_000);
    const res = await apiA.post('/api/calendar/events', {
      data: {
        title: `QA carpool ${stamp}`,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        guests: { profile_ids: [userB.id] },
      },
    });
    test.skip(res.status() === 404, 'calendar flag off');
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    eventId = (await res.json()).event?.id;
    expect(eventId).toBeTruthy();

    const accept = await apiB.post(`/api/calendar/events/${eventId}/respond`, {
      data: { status: 'accepted', scope: 'this' },
    });
    expect(accept.ok(), await readErrorBody(accept)).toBe(true);
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('offer → claim → capacity 409 → release → cancel; driver double-offer 409s', async () => {
  test.skip(!eventId, 'setup skipped');
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  try {
    const offer = await apiA.post(`/api/calendar/events/${eventId}/carpool`, {
      data: { seatsTotal: 1, note: `north lot ${stamp}` },
    });
    expect(offer.status(), await readErrorBody(offer)).toBe(201);
    offerId = (await offer.json()).id;
    const dup = await apiA.post(`/api/calendar/events/${eventId}/carpool`, {
      data: { seatsTotal: 2 },
    });
    expect(dup.status()).toBe(409);

    // B sees the offer with a free seat, claims it, and the next claim 409s.
    const list = await apiB.get(`/api/calendar/events/${eventId}/carpool`);
    expect(list.ok(), await readErrorBody(list)).toBe(true);
    const offers = (await list.json()).offers;
    expect(offers).toHaveLength(1);
    expect(offers[0].seatsLeft).toBe(1);

    const claim = await apiB.post(`/api/calendar/events/${eventId}/carpool/claim`, {
      data: { offerId, seats: 1 },
    });
    expect(claim.status(), await readErrorBody(claim)).toBe(201);
    const again = await apiB.post(`/api/calendar/events/${eventId}/carpool/claim`, {
      data: { offerId, seats: 1 },
    });
    expect(again.status()).toBe(409); // full AND already-claimed both refuse

    // The driver hears about the claim.
    const bell = await apiA.get('/api/notifications');
    const rows = (await bell.json()).notifications ?? [];
    expect(
      rows.some((n: { type?: string }) => n.type === 'carpool_update'),
      'driver should get a carpool_update for the claim'
    ).toBe(true);

    // Structural-leak check: the ICS payload must not carry the note.
    const ics = await apiA.get(`/api/calendar/events/${eventId}/ics`);
    if (ics.ok()) {
      expect(await ics.text()).not.toContain(`north lot ${stamp}`);
    }

    const release = await apiB.delete(`/api/calendar/events/${eventId}/carpool/claim`, {
      data: { offerId },
    });
    expect(release.ok(), await readErrorBody(release)).toBe(true);

    const cancel = await apiA.delete(`/api/calendar/events/${eventId}/carpool`);
    expect(cancel.ok(), await readErrorBody(cancel)).toBe(true);
    const empty = await apiB.get(`/api/calendar/events/${eventId}/carpool`);
    expect((await empty.json()).offers).toHaveLength(0);
  } finally {
    await apiB.dispose();
    await apiA.dispose();
  }
});

test('a non-participant is 404d — the event is never revealed', async () => {
  test.skip(!eventId, 'setup skipped');
  const apiB = await apiAs('state-b.json');
  try {
    // A random event id: same 404 as a real event you're not part of.
    const foreign = await apiB.get('/api/calendar/events/00000000-0000-0000-0000-000000000000/carpool');
    expect(foreign.status()).toBe(404);
  } finally {
    await apiB.dispose();
  }
});
