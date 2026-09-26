import { test, expect, request as pwRequest } from '@playwright/test';
import { adminClient, apiAs, E2E_BASE_URL, loadQaUser, readErrorBody } from './helpers/qa-user';
import { cleanupEvent } from './helpers/sport-events';

/**
 * Events program, PR 7 — the leaderboard and the results. A and B play a
 * nine; the leaderboard ranks them (computed, never stored) and hides
 * from a stranger; completion mirrors B's round onto B's profile and
 * sends the results bell; B's opt-out removes the mirror everywhere; the
 * opt back in restores it.
 */
type View = {
  event: { id: string; status: string };
  rounds: Array<{ id: string; group_post_id: string | null }>;
  participants: Array<{ id: string; profile_id: string; role: string }>;
  viewer: { participant_id: string | null };
};
type Board = { rows: Array<{ profileId: string; rankLabel: string; gross: number | null; toPar: number | null; thru: number; cardStatus: string }>; round: { group_post_id: string | null }; format: string };
type Rounds = { rounds: Array<{ id: string; course: string; holes: number; gross_score: number; profile_hidden_at?: string | null }> };

test('sport events API: leaderboard · results mirror · opt-out', async () => {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const admin = adminClient();
  const stamp = Date.now();
  const courseName = `QA Results Course ${stamp}`;
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: 'e2e/.auth/anon.json' });
  let eventId: string | null = null;
  try {
    const created = await apiA.post('/api/sport-events', {
      data: { name: `QA Results ${stamp}`, visibility: 'private', publish: true, round: { scheduled_on: '2030-06-01', course_name: courseName, holes: 9, starting_hole: 1 } },
    });
    expect(created.status(), await readErrorBody(created)).toBe(201);
    let view = (await created.json()) as View;
    eventId = view.event.id;
    const roundId = view.rounds[0].id;
    expect((await apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [userB.id] } })).ok()).toBe(true);
    const asB = (await (await apiB.get(`/api/sport-events/${eventId}`)).json()) as View;
    expect((await apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } })).ok()).toBe(true);

    // Before go-live the board is the field with nothing scored.
    const empty = (await (await apiB.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`)).json()) as Board;
    expect(empty.rows.map(r => [r.rankLabel, r.thru])).toEqual([['—', 0], ['—', 0]]);
    expect((await anon.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`)).status()).toBe(404);

    const live = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'live', today: '2030-06-01' } });
    expect(live.ok(), await readErrorBody(live)).toBe(true);
    view = (await live.json()) as View;
    const gp = view.rounds[0].group_post_id!;
    const card = (await (await apiA.get(`/api/group-posts/${gp}/scorecard`)).json()) as { scorecard: { participants: Array<{ participant: { id: string; profile_id: string } }> } };
    const rowA = card.scorecard.participants.find(p => p.participant.profile_id === userA.id)!.participant.id;
    const rowB = card.scorecard.participants.find(p => p.participant.profile_id === userB.id)!.participant.id;

    // A: 4, 4 (par 4 each — the trigger scores an off-catalog round against par 4); B: 5, 4.
    expect((await apiA.post(`/api/golf/scorecards/${rowA}/scores`, { data: { scores: [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }] } })).status()).toBe(201);
    expect((await apiB.post(`/api/golf/scorecards/${rowB}/scores`, { data: { scores: [{ hole_number: 1, strokes: 5 }, { hole_number: 2, strokes: 4 }] } })).status()).toBe(201);
    const board = await apiB.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`);
    expect(board.ok(), await readErrorBody(board)).toBe(true);
    expect(board.headers()['cache-control']).toContain('private');
    const rows = ((await board.json()) as Board).rows;
    expect(rows.map(r => [r.profileId, r.rankLabel, r.gross, r.thru])).toEqual([[userA.id, '1', 8, 2], [userB.id, '2', 9, 2]]);

    // Complete (override): B's round is on B's profile, and B got the results bell.
    expect((await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } })).ok()).toBe(true);
    const mirrored = (await (await apiB.get('/api/golf/rounds?limit=50')).json()) as Rounds;
    const mine = mirrored.rounds.find(r => r.course === courseName);
    expect(mine, 'B has the mirrored round').toBeTruthy();
    expect(mine).toMatchObject({ holes: 9, gross_score: 9 });
    const bells = (await (await apiB.get('/api/notifications')).json()) as { notifications: Array<{ type: string; title: string }> };
    expect(bells.notifications.some(n => n.type === 'sport_event_results' && n.title === `Results are in for QA Results ${stamp}`)).toBe(true);

    // B opts out → results-kept (241): the round is HIDDEN from B's profile (others no longer see
    // it listed; B still does, marked) and stays on the record; opts back in → shown. The organizer cannot flip it.
    expect((await apiA.patch(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { hide_from_profile: true } })).status()).toBe(403);
    const hide = await apiB.patch(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { hide_from_profile: true } });
    expect(hide.ok(), await readErrorBody(hide)).toBe(true);
    const afterHide = (await (await apiB.get('/api/golf/rounds?limit=50')).json()) as Rounds;
    expect(afterHide.rounds.find(r => r.course === courseName)?.profile_hidden_at, 'B still has it, hidden').toBeTruthy();
    // QA profiles are private — open B's for this check so the HIDE (not privacy) is what hides it.
    await admin.from('profiles').update({ visibility: 'public' }).eq('id', userB.id);
    try {
      const seenRes = await apiA.get(`/api/golf/rounds?limit=50&profileId=${userB.id}`);
      expect(seenRes.status(), await readErrorBody(seenRes)).toBe(200);
      const seenByA = (await seenRes.json()) as Rounds;
      expect(seenByA.rounds.find(r => r.course === courseName), 'nobody else sees it listed').toBeUndefined();
    } finally {
      await admin.from('profiles').update({ visibility: 'private' }).eq('id', userB.id);
    }
    const show = await apiB.patch(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { hide_from_profile: false } });
    expect(show.ok(), await readErrorBody(show)).toBe(true);
    const afterShow = (await (await apiB.get('/api/golf/rounds?limit=50')).json()) as Rounds;
    expect(afterShow.rounds.find(r => r.course === courseName)).toMatchObject({ gross_score: 9, profile_hidden_at: null });

    // The board survives completion, cards final.
    const finalBoard = ((await (await apiB.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard`)).json()) as Board).rows;
    expect(finalBoard.map(r => r.cardStatus)).toEqual(['final', 'final']);
    // Results-kept (241): a played event stays on the record — its delete is refused.
    const refused = await apiA.delete(`/api/sport-events/${eventId}`);
    expect(refused.status()).toBe(409);
  } finally {
    await cleanupEvent(apiA, eventId);
    await apiA.dispose();
    await apiB.dispose();
    await anon.dispose();
  }
});
