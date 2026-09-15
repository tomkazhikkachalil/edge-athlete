import { test, expect } from '@playwright/test';
import { adminClient, readErrorBody } from './helpers/qa-user';
import { cleanupEvent, createEvent, openEventSession, type EventView } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 1 — rounds as a list (API): create with
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
