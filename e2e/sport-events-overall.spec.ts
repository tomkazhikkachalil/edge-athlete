import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';
import { cardRowFor, cleanupEvent, completeRound, createEvent, inviteAndAccept, openEventSession, readScorecard, scoreHoles, startRound } from './helpers/sport-events';

/**
 * Events program, phase 2, PR 3 — the OVERALL leaderboard (API): two
 * nine-hole rounds off-catalog (every hole par 4). Round 1: A 36 (E), B 45
 * (+9) → A leads, no movement yet. Round 2 live: A scores two holes → today
 * / thru and the total move; B has not started → yesterday's total holds.
 * Round 2 completed without B scoring → B missed a round and ranks below A
 * whatever the totals; the movement column reads the change from round 1.
 * The gate is the event's (a stranger's 404); the cache header is private.
 */
type Overall = {
  event: { id: string; format: string; status: string };
  rounds: Array<{ id: string; sequence: number; status: string; group_post_id: string | null }>;
  board: {
    current: number | null;
    scoredRounds: number[];
    flights: string[];
    rows: Array<{ name: string; profileId: string; rank: number | null; rankLabel: string; total: number | null; totalToPar: number | null; roundsPlayed: number; missedRounds: number[]; today: { sequence: number; toPar: number | null; thru: number } | null; prevRank: number | null; movement: number | null; rounds: Array<{ sequence: number; gross: number | null; played: boolean }> }>;
  };
};

test('sport events API: the overall leaderboard — cumulative, today / thru, a missed round ranks below', async () => {
  const s = await openEventSession();
  let eventId: string | null = null;
  try {
    let view = await createEvent(s.apiA, {
      name: `QA Overall ${s.stamp}`,
      publish: true,
      rounds: [
        { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 9, starting_hole: 1 },
        { scheduled_on: '2030-06-02', course_name: 'QA Links', holes: 9, starting_hole: 1 },
      ],
    });
    eventId = view.event.id;
    const [r1, r2] = view.rounds.map(r => r.id);
    await inviteAndAccept(s, eventId);
    const url = `/api/sport-events/${eventId}/leaderboard`;
    const overall = async (): Promise<Overall> => {
      const res = await s.apiA.get(url);
      expect(res.ok(), await readErrorBody(res)).toBe(true);
      expect(res.headers()['cache-control']).toContain('private');
      return (await res.json()) as Overall;
    };
    const rowOf = (o: Overall, profileId: string) => o.board.rows.find(r => r.profileId === profileId)!;

    // Nothing minted yet: an empty board with both rounds as headers; a stranger gets the same 404 as the event.
    let o = await overall();
    expect(o.board.rows).toEqual([]);
    expect(o.board.current).toBeNull();
    expect(o.rounds.map(r => r.sequence)).toEqual([1, 2]);
    expect((await s.anon.get(url)).status()).toBe(404);
    expect((await s.apiA.get(`${url}?flight=`)).status()).toBe(400);

    // Round 1: A 36 (E), B 45 (+9).
    view = await startRound(s.apiA, eventId, r1, '2030-06-01');
    const card1 = await readScorecard(s.apiA, view.rounds[0].group_post_id!);
    const nine = (strokes: number) => Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes }));
    await scoreHoles(s.apiA, cardRowFor(card1, s.userA.id), nine(4));
    await scoreHoles(s.apiB, cardRowFor(card1, s.userB.id), nine(5));
    o = await overall();
    expect(o.board.current).toBe(1);
    expect(rowOf(o, s.userA.id)).toMatchObject({ rank: 1, rankLabel: '1', total: 36, totalToPar: 0, today: { sequence: 1, toPar: 0, thru: 9 }, movement: null });
    expect(rowOf(o, s.userB.id)).toMatchObject({ rank: 2, total: 45, totalToPar: 9 });
    await completeRound(s.apiA, eventId, r1);
    o = await overall();
    expect(o.board.scoredRounds).toEqual([1]);
    expect(rowOf(o, s.userA.id).today).toBeNull();

    // Round 2 live: A scores two holes — today / thru and the total move; B has not started, so B's standing holds.
    view = await startRound(s.apiA, eventId, r2, '2030-06-02');
    const card2 = await readScorecard(s.apiA, view.rounds[1].group_post_id!);
    await scoreHoles(s.apiA, cardRowFor(card2, s.userA.id), [{ hole_number: 1, strokes: 5 }, { hole_number: 2, strokes: 4 }]);
    o = await overall();
    expect(o.board.current).toBe(2);
    expect(rowOf(o, s.userA.id)).toMatchObject({ rank: 1, total: 45, totalToPar: 1, today: { sequence: 2, toPar: 1, thru: 2 }, prevRank: 1, movement: 0, missedRounds: [] });
    expect(rowOf(o, s.userB.id)).toMatchObject({ rank: 2, total: 45, totalToPar: 9, today: { sequence: 2, toPar: null, thru: 0 }, prevRank: 2, movement: 0, missedRounds: [] });
    expect(rowOf(o, s.userA.id).rounds.map(r => [r.sequence, r.gross, r.played])).toEqual([[1, 36, true], [2, 9, true]]);

    // Round 2 completed with B never scoring: B missed a round and ranks below A; two rounds scored.
    await completeRound(s.apiA, eventId, r2);
    o = await overall();
    expect(o.event.status).toBe('completed');
    expect(o.board.scoredRounds).toEqual([1, 2]);
    expect(rowOf(o, s.userA.id)).toMatchObject({ rank: 1, roundsPlayed: 2, missedRounds: [], today: null });
    expect(rowOf(o, s.userB.id)).toMatchObject({ rank: 2, roundsPlayed: 1, missedRounds: [2], prevRank: 2, movement: 0 });

    // A flight nobody is in filters to nothing; the flights list is empty until phase 2's flights PR.
    const flightRes = await s.apiA.get(`${url}?flight=A`);
    expect(flightRes.ok(), await readErrorBody(flightRes)).toBe(true);
    expect(((await flightRes.json()) as Overall).board).toMatchObject({ rows: [], flights: [] });
  } finally {
    await cleanupEvent(s.apiA, eventId);
    await s.dispose();
  }
});
