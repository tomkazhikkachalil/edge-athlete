import { test, expect } from '@playwright/test';
import { adminClient } from './helpers/qa-user';
import { cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, startRound } from './helpers/sport-events';

/**
 * Events program, phase 4, PR 2 — the live bell and Live Now for events.
 * B follows A's public event; the round starts → ONE `sport_event_live`
 * bell for B (the followers only — A plays; no actor) landing on the live
 * board; a second start attempt (refused) bells none; the live-now route
 * lists the event for a STRANGER (signed out) and its count is ≥ 1; after
 * the round completes the event leaves the list. Zero DDL (the type has
 * been in the CHECK since 205).
 */
test('the live bell to followers, once per round; Live Now lists a public live event signed out', async () => {
  const s = await openEventSession();
  const admin = adminClient();
  let eventId: string | null = null;
  try {
    const view = await createEvent(s.apiA, { name: `QA Live Bell ${s.stamp}`, visibility: 'public', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Live Links', holes: 9, starting_hole: 1 } });
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    await inviteAndAccept(s, eventId); // B plays
    // C follows when the four QA users are minted (an older setup has two: the bell assertions then skip, the rest still runs).
    const apiC = s.apiC;
    const followed = apiC ? await apiC.post(`/api/sport-events/${eventId}/follow`, { data: {} }) : null;
    const followerId = apiC && followed?.ok() && s.userC ? s.userC.id : null;

    await startRound(s.apiA, eventId, roundId, '2030-06-01');
    if (followerId) {
      const bells = await admin.from('notifications').select('title, action_url, actor_id, metadata').eq('user_id', followerId).eq('type', 'sport_event_live').contains('metadata', { sport_event_round_id: roundId });
      expect(bells.data).toHaveLength(1);
      expect(bells.data![0]).toMatchObject({ title: `Live now: QA Live Bell ${s.stamp}`, action_url: `/events/${eventId}?tab=leaderboard&round=${roundId}`, actor_id: null });
    }
    // B plays → no live bell for B.
    const bellsB = await admin.from('notifications').select('id').eq('user_id', s.userB.id).eq('type', 'sport_event_live').contains('metadata', { sport_event_round_id: roundId });
    expect(bellsB.data).toHaveLength(0);
    // A second start is refused and bells nobody.
    expect((await s.apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to: 'live' } })).status()).toBe(409);
    if (followerId) {
      const again = await admin.from('notifications').select('id').eq('user_id', followerId).eq('type', 'sport_event_live').contains('metadata', { sport_event_round_id: roundId });
      expect(again.data).toHaveLength(1);
    }

    // Live Now, signed out: the public live event is listed with its door; the count counts it.
    const anon = await s.anon.get('/api/sport-events/live-now');
    expect(anon.status()).toBe(200);
    const listed = ((await anon.json()) as { events: Array<{ id: string; href: string; playing: number }> }).events.find(e => e.id === eventId);
    expect(listed).toMatchObject({ href: `/events/${eventId}?tab=leaderboard&round=${roundId}`, playing: 2 });
    const count = (await (await s.anon.get('/api/sport-events/live-now?count=1')).json()) as { count: number };
    expect(count.count).toBeGreaterThanOrEqual(1);

    // Completed → gone from the list.
    await completeRound(s.apiA, eventId, roundId, true);
    const after = ((await (await s.anon.get('/api/sport-events/live-now')).json()) as { events: Array<{ id: string }> }).events;
    expect(after.find(e => e.id === eventId)).toBeUndefined();
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
