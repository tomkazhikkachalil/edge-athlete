import { test, expect } from '@playwright/test';
import { apiAs, loadQaUser, readErrorBody } from './helpers/qa-user';

/**
 * Events program, PR 6 — scoring authorization on an event round. A hosts
 * and plays, B plays in A's group (a back nine from hole 10). B scores A's
 * card as a GROUP-MATE (never possible before), the hole range refuses
 * hole 3, a stale expected_version is a 409 naming the hole (209), A submits and B may no
 * longer touch A's card, A finalizes B's card and B is locked out of their
 * own, reopen restores it, completion waits for every card to be final.
 */
type View = {
  event: { id: string; status: string };
  rounds: Array<{ id: string; group_post_id: string | null }>;
  participants: Array<{ id: string; profile_id: string; role: string }>;
  viewer: { participant_id: string | null };
};
type Scorecard = { scorecard: { participants: Array<{ participant: { id: string; profile_id: string }; scores: { status?: string; updated_at: string | null; hole_scores: Array<{ hole_number: number; strokes: number; version?: number }> } }> } };
type Conflict409 = { error: string; conflicts: Array<{ hole_number: number; current: { version: number; strokes: number } | null }>; written: number };

test('sport events API: group-mate scoring · hole range · conflict · submit · finalize · complete', async () => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const stamp = Date.now();
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', {
      data: { name: `QA Scoring ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: 'QA Back Nine', holes: 9, starting_hole: 10 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    let view = (await created.json()) as View;
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    const invited = await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } });
    expect(invited.ok(), await readErrorBody(invited)).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    const acceptedB = await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } });
    expect(acceptedB.ok(), await readErrorBody(acceptedB)).toBe(true);
    const hostRow = asB.participants.find(p => p.role === 'organizer')!;
    const grouped = await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups: [{ members: [hostRow.id, asB.viewer.participant_id] }] } });
    expect(grouped.ok(), await readErrorBody(grouped)).toBe(true);
    const live = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    view = (await live.json()) as View;
    const gp = view.rounds[0].group_post_id!;

    const readCard = async (): Promise<Scorecard['scorecard']> => ((await (await apiA.get(`/api/group-posts/${gp}/scorecard`)).json()) as Scorecard).scorecard;
    let card = await readCard();
    const rowA = card.participants.find(p => p.participant.profile_id === userA.id)!.participant.id;
    const rowB = card.participants.find(p => p.participant.profile_id === userB.id)!.participant.id;

    // B scores A's card as a group-mate (hole 10 of a back nine).
    const byMate = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 10, strokes: 5 }] } });
    expect(byMate.status(), await readErrorBody(byMate)).toBe(201);
    // Hole 3 is not on this card.
    const offCard = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 3, strokes: 4 }] } });
    expect(offCard.status()).toBe(400);
    expect(await offCard.text()).toContain('holes 10–18');
    // The per-hole compare-and-set (209): hole 10 is at version 1 after B's
    // write; a stale expected_version is a 409 naming the hole with its
    // current row; the right version writes and bumps it; 0 on an unscored
    // hole inserts, 0 again conflicts; the old card-stamp guard is ignored.
    card = await readCard();
    const hole10 = card.participants.find(p => p.participant.profile_id === userA.id)!.scores.hole_scores.find(h => h.hole_number === 10)!;
    expect(hole10.version).toBe(1);
    const stale = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 10, strokes: 4, expected_version: 5 }] } });
    expect(stale.status()).toBe(409);
    const staleBody = (await stale.json()) as Conflict409;
    expect(staleBody.conflicts).toEqual([{ hole_number: 10, current: expect.objectContaining({ version: 1, strokes: 5 }) }]);
    expect(staleBody.written).toBe(0);
    const right = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 10, strokes: 4, expected_version: 1 }] } });
    expect(right.status(), await readErrorBody(right)).toBe(201);
    card = await readCard();
    expect(card.participants.find(p => p.participant.profile_id === userA.id)!.scores.hole_scores.find(h => h.hole_number === 10)).toMatchObject({ strokes: 4, version: 2 });
    const unscored = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 11, strokes: 4, expected_version: 0 }] } });
    expect(unscored.status(), await readErrorBody(unscored)).toBe(201);
    const twice = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 11, strokes: 3, expected_version: 0 }] } });
    expect(twice.status()).toBe(409);
    expect(((await twice.json()) as Conflict409).conflicts[0]).toMatchObject({ hole_number: 11, current: { version: 1, strokes: 4 } });
    const bad = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 11, strokes: 3, expected_version: -1 }] } });
    expect(bad.status()).toBe(400);
    expect(await bad.text()).toContain('expected_version');
    const legacy = await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 12, strokes: 4 }], expected_updated_at: '2020-01-01T00:00:00Z' } });
    expect(legacy.status(), await readErrorBody(legacy)).toBe(201);

    // A submits; B may no longer touch A's card; A's own write reopens it; A submits again.
    const submit = await apiA.post(`/api/sport-events/${eventId}/cards/${rowA}/submit`);
    expect(submit.ok(), await readErrorBody(submit)).toBe(true);
    expect(((await submit.json()) as { card: { status: string; scores_confirmed: boolean } }).card).toMatchObject({ status: 'submitted', scores_confirmed: true });
    expect((await apiB.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 12, strokes: 4 }] } })).status()).toBe(409);
    expect((await apiB.post(`/api/sport-events/${eventId}/cards/${rowA}/submit`)).status()).toBe(403);
    const own = await apiA.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 12, strokes: 4 }] } });
    expect(own.status(), await readErrorBody(own)).toBe(201);
    expect(((await (await apiA.get(`/api/golf/scorecards/${rowA}/scores`)).json()) as { golf_scores: { status: string } }).golf_scores.status).toBe('in_progress');
    expect((await apiA.post(`/api/sport-events/${eventId}/cards/${rowA}/submit`)).ok()).toBe(true);

    // B scores their own card; A finalizes it; B is locked out; B cannot finalize; reopen restores B.
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 10, strokes: 6 }] } })).status()).toBe(201);
    const finalB = await apiA.post(`/api/sport-events/${eventId}/cards/${rowB}/finalize`);
    expect(finalB.ok(), await readErrorBody(finalB)).toBe(true);
    expect(((await finalB.json()) as { card: { status: string; finalized_by: string } }).card).toMatchObject({ status: 'final', finalized_by: userA.id });
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 11, strokes: 5 }] } })).status()).toBe(409);
    expect((await apiB.post(`/api/sport-events/${eventId}/cards/${rowA}/finalize`)).status()).toBe(403);
    const reopen = await apiA.post(`/api/sport-events/${eventId}/cards/${rowB}/finalize`, { data: { reopen: true } });
    expect(reopen.ok(), await readErrorBody(reopen)).toBe(true);
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 11, strokes: 5 }] } })).status()).toBe(201);

    // Completion waits for every card: B's is in progress → refused; finalize both → completes without override.
    const refused = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed' } });
    expect(refused.status()).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toBe('cards_not_final');
    expect((await apiA.post(`/api/sport-events/${eventId}/cards/${rowB}/finalize`)).ok()).toBe(true);
    expect((await apiA.post(`/api/sport-events/${eventId}/cards/${rowA}/finalize`)).ok()).toBe(true);
    const completed = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed' } });
    expect(completed.ok(), await readErrorBody(completed)).toBe(true);
    expect(((await completed.json()) as View).event.status).toBe('completed');
    const del = await apiA.delete(`/api/sport-events/${eventId}`);
    expect(del.ok(), await readErrorBody(del)).toBe(true);
    eventId = null;
  } finally {
    if (eventId) {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
    }
    await apiA.dispose();
    await apiB.dispose();
  }
});
