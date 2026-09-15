import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cancelRound, cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, setGroups, startRound, type EventView } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 1 + PR 2 — rounds as a list and the round
 * lifecycle (API). PR 1: create with
 * three rounds (sequenced, starts_on = the first), the phase-1 single-round
 * body still creates, both shapes at once and an out-of-order list are
 * refused by name, add a round (appended; an earlier date refused; the
 * announce post minted when the event is open), edit a round keeps the
 * date order, delete the middle round renumbers, the last round cannot be
 * removed, a stranger and a player cannot touch the rounds.
 */
test('sport events API: rounds as a list — create · add · edit · delete · the last stays', async () => {
  const s = await openEventSession();
  const ids: string[] = [];
  try {
    // Create with three rounds: sequences 1..3, starts_on = the first.
    let view = await createEvent(s.apiA, {
      name: `QA Rounds ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 18 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 18 },
        { scheduled_on: '2030-06-03', course_name: 'QA Back Nine', holes: 9, starting_hole: 10 },
      ],
    });
    const eventId = view.event.id;
    ids.push(eventId);
    expect(view.event.status).toBe('open');
    expect(view.event.starts_on).toBe('2030-06-01');
    expect(view.rounds.map(r => [r.sequence, r.scheduled_on, r.status])).toEqual([[1, '2030-06-01', 'scheduled'], [2, '2030-06-02', 'scheduled'], [3, '2030-06-03', 'scheduled']]);
    const [r1, r2, r3] = view.rounds.map(r => r.id);
    // One announce post per round at Open.
    const admin = adminClient();
    const { data: posts } = await admin.from('posts').select('id, sport_event_round_id').in('sport_event_round_id', [r1, r2, r3]);
    expect((posts ?? []).length).toBe(3);

    // The phase-1 body (one `round`) still creates; both shapes at once and an out-of-order list are refused by name.
    const single = await createEvent(s.apiA, { name: `QA Single ${s.stamp}`, round: { scheduled_on: '2030-07-01', course_name: 'QA Links' } });
    ids.push(single.event.id);
    expect(single.rounds).toHaveLength(1);
    const both = await s.apiA.post('/api/sport-events', { data: { name: 'x', round: { scheduled_on: '2030-07-01', course_name: 'Q' }, rounds: [{ scheduled_on: '2030-07-01', course_name: 'Q' }] } });
    expect(both.status()).toBe(400);
    expect(await both.text()).toContain('not both');
    const unordered = await s.apiA.post('/api/sport-events', { data: { name: 'x', rounds: [{ scheduled_on: '2030-07-02', course_name: 'Q' }, { scheduled_on: '2030-07-01', course_name: 'Q' }] } });
    expect(unordered.status()).toBe(400);
    expect(await unordered.text()).toContain('rounds[1].scheduled_on');

    // Add a round: an earlier date than the last is refused; a later one is appended as round 4 and, the event being open, gets its announce post.
    const early = await s.apiA.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: '2030-06-02', course_name: 'QA Links' } });
    expect(early.status()).toBe(400);
    expect(((await early.json()) as { reason: string }).reason).toBe('round_out_of_order');
    const added = await s.apiA.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: '2030-06-04', course_name: 'QA Links', holes: 9 } });
    expect(added.status(), await readErrorBody(added)).toBe(201);
    view = (await added.json()) as EventView;
    expect(view.rounds.map(r => r.sequence)).toEqual([1, 2, 3, 4]);
    const r4 = view.rounds[3].id;
    const { data: post4 } = await admin.from('posts').select('id').eq('sport_event_round_id', r4);
    expect((post4 ?? []).length).toBe(1);

    // A stranger (anon) and a non-organizer cannot add or remove rounds.
    expect((await s.anon.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: '2030-06-05', course_name: 'Q' } })).status()).toBe(401);
    expect((await s.apiB.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: '2030-06-05', course_name: 'Q' } })).status()).toBe(404);
    expect((await s.apiB.delete(`/api/sport-events/${eventId}/rounds/${r2}`)).status()).toBe(404);

    // Edit round 2: a date after round 3's is refused; a valid edit re-snapshots the course.
    const late = await s.apiA.put(`/api/sport-events/${eventId}/rounds/${r2}`, { data: { scheduled_on: '2030-06-05', course_name: 'QA Links' } });
    expect(late.status()).toBe(400);
    expect(await late.text()).toContain('next round');
    const edited = await s.apiA.put(`/api/sport-events/${eventId}/rounds/${r2}`, { data: { scheduled_on: '2030-06-02', course_name: 'QA Renamed' } });
    expect(edited.ok(), await readErrorBody(edited)).toBe(true);
    view = (await edited.json()) as EventView;
    expect(view.rounds[1].course_name).toBe('QA Renamed');

    // Delete the middle round: 3 and 4 move up; its announce post is gone; starts_on unchanged.
    const del2 = await s.apiA.delete(`/api/sport-events/${eventId}/rounds/${r2}`);
    expect(del2.ok(), await readErrorBody(del2)).toBe(true);
    view = (await del2.json()) as EventView;
    expect(view.rounds.map(r => [r.id, r.sequence])).toEqual([[r1, 1], [r3, 2], [r4, 3]]);
    expect(view.event.starts_on).toBe('2030-06-01');
    const { data: gone } = await admin.from('posts').select('id').eq('sport_event_round_id', r2);
    expect((gone ?? []).length).toBe(0);
    expect((await s.apiA.delete(`/api/sport-events/${eventId}/rounds/${r2}`)).status()).toBe(404);

    // Delete the first round: starts_on moves to the new first.
    const del1 = await s.apiA.delete(`/api/sport-events/${eventId}/rounds/${r1}`);
    expect(del1.ok(), await readErrorBody(del1)).toBe(true);
    view = (await del1.json()) as EventView;
    expect(view.rounds.map(r => [r.id, r.sequence])).toEqual([[r3, 1], [r4, 2]]);
    expect(view.event.starts_on).toBe('2030-06-03');

    // Down to one: the last round cannot be removed.
    const del3 = await s.apiA.delete(`/api/sport-events/${eventId}/rounds/${r3}`);
    expect(del3.ok(), await readErrorBody(del3)).toBe(true);
    const last = await s.apiA.delete(`/api/sport-events/${eventId}/rounds/${r4}`);
    expect(last.status()).toBe(409);
    expect(((await last.json()) as { reason: string }).reason).toBe('last_round');

    // The cap: 8 rounds at most.
    for (let i = 0; i < 7; i++) {
      const res = await s.apiA.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: `2030-06-${String(10 + i).padStart(2, '0')}`, course_name: 'QA Links' } });
      expect(res.status(), await readErrorBody(res)).toBe(201);
    }
    const ninth = await s.apiA.post(`/api/sport-events/${eventId}/rounds`, { data: { scheduled_on: '2030-06-20', course_name: 'QA Links' } });
    expect(ninth.status()).toBe(409);
    expect(((await ninth.json()) as { reason: string }).reason).toBe('too_many_rounds');
  } finally {
    for (const id of ids) await cleanupEvent(s.apiA, id);
    await s.dispose();
  }
});

/**
 * Phase 2, PR 2 — the round lifecycle (API): rounds run one at a time and
 * the event follows its rounds. Round 2 cannot start before round 1 nor
 * while round 1 is live; starting round 1 takes the open event live and
 * leaves round 2 scheduled and unminted; round 2 is regrouped and edited
 * while round 1 is live; the event-level complete refuses while a round is
 * still scheduled; completing round 1 needs its cards final (the override
 * finalizes them), mirrors ONE round and leaves the event live with no
 * results bell; a round added while live is scheduled and cancels; a
 * completed round neither cancels nor deletes; completing the last round
 * completes the event: the stamp, ONE results bell, two mirrored rounds.
 */
test('sport events API: the round lifecycle — one round at a time; the event follows its rounds', async () => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, {
      name: `QA Lifecycle2 ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    const { participantId: rowB, hostRowId } = await inviteAndAccept(s, eventId);
    const base = `/api/sport-events/${eventId}`;

    // In order: round 2 cannot start first; a player cannot start anything; the vocabulary is the round's.
    const early = await s.apiA.post(`${base}/rounds/${r2}/transition`, { data: { to: 'live' } });
    expect(early.status()).toBe(409);
    expect(((await early.json()) as { reason: string }).reason).toBe('earlier_round_pending');
    expect((await s.apiB.post(`${base}/rounds/${r1}/transition`, { data: { to: 'live' } })).status()).toBe(403);
    expect((await s.apiA.post(`${base}/rounds/${r1}/transition`, { data: { to: 'open' } })).status()).toBe(400);

    // Start round 1: the event goes live with it; round 2 stays scheduled and unminted.
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    expect(view.event.status).toBe('live');
    expect(view.event.went_live_at).toBeTruthy();
    expect(view.rounds.map(r => [r.status, r.group_post_id !== null])).toEqual([['live', true], ['scheduled', false]]);
    const gp1 = view.rounds[0].group_post_id!;

    // One at a time: round 2 is refused while round 1 is live; round 1 cannot start twice.
    const busy = await s.apiA.post(`${base}/rounds/${r2}/transition`, { data: { to: 'live' } });
    expect(busy.status()).toBe(409);
    expect(((await busy.json()) as { reason: string }).reason).toBe('another_round_live');
    const twice = await s.apiA.post(`${base}/rounds/${r1}/transition`, { data: { to: 'live' } });
    expect(twice.status()).toBe(409);
    expect(((await twice.json()) as { reason: string }).reason).toBe('invalid_transition');

    // Round 2 is regrouped and edited while round 1 is live; round 1's plan and groups are closed.
    await setGroups(s.apiA, eventId, r2, [{ members: [rowB, hostRowId] }]);
    expect((await s.apiA.put(`${base}/rounds/${r1}/groups`, { data: { groups: [] } })).status()).toBe(409);
    const edit2 = await s.apiA.put(`${base}/rounds/${r2}`, { data: { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9 } });
    expect(edit2.ok(), await readErrorBody(edit2)).toBe(true);
    expect((await s.apiA.put(`${base}/rounds/${r1}`, { data: { scheduled_on: '2030-06-01', course_name: 'X' } })).status()).toBe(409);

    // The event-level complete refuses while round 2 is still scheduled.
    const remaining = await s.apiA.post(`${base}/transition`, { data: { to: 'completed', override: true } });
    expect(remaining.status()).toBe(409);
    expect(((await remaining.json()) as { reason: string }).reason).toBe('rounds_remaining');

    // B scores round 1; completing needs the cards final; the override completes THIS round only.
    const cardB1 = cardRowFor(await readScorecard(s.apiB, gp1), s.userB.id);
    await scoreHoles(s.apiB, cardB1, [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 5 }]);
    const notFinal = await s.apiA.post(`${base}/rounds/${r1}/transition`, { data: { to: 'completed' } });
    expect(notFinal.status()).toBe(409);
    expect(((await notFinal.json()) as { reason: string }).reason).toBe('cards_not_final');
    view = await completeRound(s.apiA, eventId, r1);
    expect(view.event.status).toBe('live');
    expect(view.event.completed_at).toBeNull();
    expect(view.rounds.map(r => [r.status, r.group_post_id !== null])).toEqual([['completed', true], ['scheduled', false]]);
    const admin = adminClient();
    const mirrored1 = await admin.from('golf_rounds').select('id').eq('profile_id', s.userB.id).eq('group_post_id', gp1);
    expect((mirrored1.data ?? []).length).toBe(1);
    const bellsBefore = await admin.from('notifications').select('id').eq('user_id', s.userB.id).eq('type', 'sport_event_results').eq('metadata->>sport_event_id', eventId);
    expect((bellsBefore.data ?? []).length).toBe(0);

    // A round added while live is scheduled and cancels (never the last); a completed round neither cancels nor deletes.
    const added = await s.apiA.post(`${base}/rounds`, { data: { scheduled_on: '2030-06-03', course_name: 'QA Links', holes: 9 } });
    expect(added.status(), await readErrorBody(added)).toBe(201);
    const r3 = ((await added.json()) as EventView).rounds[2].id;
    view = await cancelRound(s.apiA, eventId, r3);
    expect(view.rounds.map(r => r.status)).toEqual(['completed', 'scheduled', 'cancelled']);
    expect(view.event.status).toBe('live');
    expect(view.event.starts_on).toBe('2030-06-01');
    expect((await s.apiA.post(`${base}/rounds/${r1}/transition`, { data: { to: 'cancelled' } })).status()).toBe(409);
    const delDone = await s.apiA.delete(`${base}/rounds/${r1}`);
    expect(delDone.status()).toBe(409);
    expect(((await delDone.json()) as { reason: string }).reason).toBe('not_scheduled');

    // Start round 2 (the groups plan puts B first), score, complete → the event completes with its last round.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const gp2 = view.rounds[1].group_post_id!;
    const card2 = await readScorecard(s.apiB, gp2);
    expect(card2.sport_event!.group!.members.map(m => m.profile_id)).toEqual([s.userB.id, s.userA.id]);
    await scoreHoles(s.apiB, cardRowFor(card2, s.userB.id), [{ hole_number: 1, strokes: 4 }]);
    view = await completeRound(s.apiA, eventId, r2);
    expect(view.event.status).toBe('completed');
    expect(view.event.completed_at).toBeTruthy();
    expect(view.rounds.map(r => r.status)).toEqual(['completed', 'completed', 'cancelled']);
    const mirrored = await admin.from('golf_rounds').select('group_post_id').eq('profile_id', s.userB.id).in('group_post_id', [gp1, gp2]);
    expect((mirrored.data ?? []).map(r => r.group_post_id).sort()).toEqual([gp1, gp2].sort());
    const bells = await admin.from('notifications').select('id').eq('user_id', s.userB.id).eq('type', 'sport_event_results').eq('metadata->>sport_event_id', eventId);
    expect((bells.data ?? []).length).toBe(1);

    // Over: nothing starts; the completed event deletes.
    expect((await s.apiA.post(`${base}/rounds/${r2}/transition`, { data: { to: 'live' } })).status()).toBe(409);
    const del = await s.apiA.delete(base);
    expect(del.ok(), await readErrorBody(del)).toBe(true);
    eventId = null;
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
