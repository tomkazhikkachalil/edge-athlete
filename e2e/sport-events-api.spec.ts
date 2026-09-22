import { test, expect, request as pwRequest } from '@playwright/test';
import { apiAs, E2E_BASE_URL, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program, PR 4 — the API half of event-join: create, the gate per
 * visibility, invite → accept with capacity 1 → waitlist → a capacity raise
 * promotes, the link token and its rotation, follow, delete. A is the host,
 * B the invitee; an unauthenticated context is the stranger. Teardown: the
 * event is deleted at the end (and A's profile cascade would take it
 * anyway).
 */
type View = {
  event: { id: string; status: string; visibility: string; link_token: string | null; capacity: number | null };
  participants: Array<{ id: string; profile_id: string; status: string; role: string; waitlist_position: number | null }>;
  counts: { playing: number; followers: number; waitlisted: number };
  viewer: { role: string; can_manage: boolean; participant_id: string | null; participant_status: string | null };
};

test('sport events API: create → invite → waitlist → promote → link → follow → delete', async () => {
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  // The config's `use.storageState` reaches every context, the `request`
  // fixture AND a bare newContext — a real stranger needs an EMPTY state.
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: 'e2e/.auth/anon.json' });
  let eventId: string | null = null;
  try {
    // Create: private, invite-only, capacity 1, the host plays → the one seat is taken.
    const created = await apiA.post('/api/sport-events', {
      data: { name: `QA Event ${stamp}`, visibility: 'private', capacity: 1, round: { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 10 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    const view = (await created.json()) as View;
    eventId = view.event.id;
    expect(view.event.status).toBe('draft');
    expect(view.viewer).toMatchObject({ role: 'organizer', can_manage: true });
    expect(view.counts.playing).toBe(1);

    // A stranger (B) and anon cannot see a private event — the same 404.
    expect((await apiB.get(`/api/sport-events/${eventId}`)).status()).toBe(404);
    expect((await anon.get(`/api/sport-events/${eventId}`)).status()).toBe(404);

    // Validation names the field.
    const bad = await apiA.patch(`/api/sport-events/${eventId}`, { data: { status: 'live' } });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain('Unknown field');

    // Invite B (by id). B can now see it and is `invited`.
    const invited = await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } });
    expect(invited.ok(), await readErrorBody(invited)).toBe(true);
    expect(((await invited.json()) as { invited: string[] }).invited).toEqual([userB.id]);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    expect(asB.viewer).toMatchObject({ role: 'participant', participant_status: 'invited', can_manage: false });
    expect(asB.event.link_token).toBeNull();

    // B cannot answer for A's row; A cannot accept for B.
    const hostRow = asB.participants.find(p => p.role === 'organizer')!;
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${hostRow.id}`, { data: { action: 'withdraw' } })).status()).toBe(403);

    // B accepts → the event is full → waitlisted #1.
    const accepted = await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } });
    expect(accepted.ok(), await readErrorBody(accepted)).toBe(true);
    expect(((await accepted.json()) as { participant: { status: string; waitlist_position: number } }).participant).toMatchObject({ status: 'waitlisted', waitlist_position: 1 });

    // A raises the capacity → B is promoted.
    const raised = await apiA.patch(`/api/sport-events/${eventId}`, { data: { capacity: 2 } });
    expect(raised.ok(), await readErrorBody(raised)).toBe(true);
    const afterRaise = (await raised.json()) as View & { promoted: string[] };
    expect(afterRaise.promoted).toEqual([asB.viewer.participant_id]);
    expect(afterRaise.counts).toMatchObject({ playing: 2, waitlisted: 0 });

    // B's list shows it under mine.
    const list = (await (await apiB.get('/api/sport-events?scope=mine')).json()) as { events: Array<{ id: string; my_status: string }> };
    expect(list.events.find(e => e.id === eventId)).toMatchObject({ my_status: 'accepted' });

    // Link visibility: a token is minted; anon needs it; rotation kills the old one.
    const linked = await apiA.patch(`/api/sport-events/${eventId}`, { data: { visibility: 'link' } });
    expect(linked.ok(), await readErrorBody(linked)).toBe(true);
    const token = ((await linked.json()) as View).event.link_token;
    expect(token).toBeTruthy();
    expect((await anon.get(`/api/sport-events/${eventId}`)).status()).toBe(404);
    expect((await anon.get(`/api/sport-events/${eventId}?token=${token}`)).status()).toBe(200);
    const rotated = await apiA.post(`/api/sport-events/${eventId}/link-token`);
    expect(rotated.ok(), await readErrorBody(rotated)).toBe(true);
    const token2 = ((await rotated.json()) as { link_token: string }).link_token;
    expect(token2).not.toBe(token);
    expect((await anon.get(`/api/sport-events/${eventId}?token=${token}`)).status()).toBe(404);
    expect((await anon.get(`/api/sport-events/${eventId}?token=${token2}`)).status()).toBe(200);

    // B withdraws (a withdrawn player still sees the event — only declined /
    // removed are out), A makes it private again, B follows: a follower sees
    // a private event and takes no seat; unfollow deletes the row and the
    // private event vanishes for B.
    const withdrew = await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'withdraw' } });
    expect(withdrew.ok(), await readErrorBody(withdrew)).toBe(true);
    const back = await apiA.patch(`/api/sport-events/${eventId}`, { data: { visibility: 'private' } });
    expect(back.ok(), await readErrorBody(back)).toBe(true);
    expect(((await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View).viewer.participant_status).toBe('withdrawn');
    const followed = await apiB.post(`/api/sport-events/${eventId}/follow`);
    expect(followed.ok(), await readErrorBody(followed)).toBe(true);
    const asFollower = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    expect(asFollower.viewer).toMatchObject({ role: 'follower', participant_status: 'accepted' });
    expect(asFollower.counts).toMatchObject({ playing: 1, followers: 1 });
    const unfollowed = await apiB.delete(`/api/sport-events/${eventId}/follow`);
    expect(unfollowed.ok(), await readErrorBody(unfollowed)).toBe(true);
    expect((await apiB.get(`/api/sport-events/${eventId}`)).status()).toBe(404);
  } finally {
    if (eventId) {
      const del = await apiA.delete(`/api/sport-events/${eventId}`);
      expect(del.ok(), await readErrorBody(del)).toBe(true);
      expect((await apiA.get(`/api/sport-events/${eventId}`)).status()).toBe(404);
    }
    await apiA.dispose();
    await apiB.dispose();
    await anon.dispose();
  }
});
