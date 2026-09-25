import { describe, expect, it } from 'vitest';
import { completionSnapshot, computeMatch, concessionRefusal, extraHoleRefusal, groupsIncomplete, holeOrderFor, playingHandicaps, sidesOf, singlesSideFor, type MatchInput, type MatchPlayer, type MatchSideInput } from '../match';

const nine = Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, handicap: i + 1 }));
const scores = (per: Array<number | null>, from = 1) => per.map((s, i) => ({ hole_number: from + i, strokes: s }));
const player = (id: string, name: string, position: number, holeScores: MatchPlayer['holeScores'], courseHandicap: number | null = 0): MatchPlayer => ({ participantId: id, profileId: `pf-${id}`, name, position, courseHandicap, holeScores });
const side = (s: 1 | 2, players: MatchPlayer[]): MatchSideInput => ({ side: s, players });
const base = (over: Partial<MatchInput> = {}): MatchInput => ({
  format: 'match_gross', sides: 'singles', allowancePct: 100, holes: 9, holeOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9], holeData: nine,
  sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4, 4, 4]))]),
  sideB: side(2, [player('b', 'Bob', 2, scores([5, 5, 5, 4, 4, 4, 5, 4, 4]))]),
  concessions: [], extraHoles: [], decision: null, ...over,
});

describe('holeOrderFor', () => {
  it('rotates the round\'s holes to the group\'s starting hole; a start outside the round keeps the round\'s order', () => {
    expect(holeOrderFor({ holes: 9, starting_hole: 1 }, 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holeOrderFor({ holes: 9, starting_hole: 10 }, 14)).toEqual([14, 15, 16, 17, 18, 10, 11, 12, 13]);
    expect(holeOrderFor({ holes: 18, starting_hole: 1 }, 10)[0]).toBe(10);
    expect(holeOrderFor({ holes: 9, starting_hole: 1 }, 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holeOrderFor({ holes: 9, starting_hole: 1 }, null)).toHaveLength(9);
  });
});

describe('computeMatch — singles, gross', () => {
  it('a hole counts when both sides scored; lower wins, ties halve; closed out at 4&2 after seven holes', () => {
    const m = computeMatch(base());
    // A wins 1, 2, 3; halves 4, 5, 6; wins 7 → 4 up with 2 to play.
    expect(m.holes.map(h => h.winner)).toEqual([1, 1, 1, null, null, null, 1, null, null]);
    expect(m).toMatchObject({ status: 'completed', up: 4, thru: 9, remaining: 0, decidedBy: 'holes', winnerSide: 1 });
    // The closed-out reading comes from the holes as they were contested in order:
    const partial = computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([5, 5, 5, 4, 4, 4, 5]))]) }));
    expect(partial).toMatchObject({ status: 'completed', up: 4, thru: 7, remaining: 2, closedOut: true, result: '4&2', summary: 'Ann wins 4&2' });
    expect(completionSnapshot(partial)).toEqual({ decided_by: 'holes', winner_side: 1, result: '4&2' });
  });
  it('2 up on the last hole; all square thru n while live; dormie; not started', () => {
    const won = computeMatch(base({ sideB: side(2, [player('b', 'Bob', 2, scores([5, 5, 4, 4, 4, 4, 4, 4, 4]))]) }));
    expect(won).toMatchObject({ status: 'completed', result: '2 up', summary: 'Ann wins 2 up', closedOut: false, winnerSide: 1 });
    const live = computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4, 4, 4]))]) }));
    expect(live).toMatchObject({ status: 'live', up: 0, thru: 3, summary: 'All square thru 3', winnerSide: null });
    const dormie = computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([5, 5, 4, 4, 4, 4, 4]))]) }));
    expect(dormie).toMatchObject({ status: 'live', up: 2, remaining: 2, dormie: true, summary: 'Ann dormie 2' });
    expect(computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, [])]), sideB: side(2, [player('b', 'Bob', 2, [])]) }))).toMatchObject({ status: 'not_started', summary: 'Not started' });
    expect(completionSnapshot(live)).toBeNull();
  });
  it('a shotgun start contests the holes in play order — thru and remaining follow the group\'s order', () => {
    const order = holeOrderFor({ holes: 9, starting_hole: 1 }, 5); // 5..9, 1..4
    const m = computeMatch(base({ holeOrder: order, sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4], 5))]), sideB: side(2, [player('b', 'Bob', 2, scores([5, 5, 5], 5))]) }));
    expect(m.holes.map(h => [h.n, h.hole])).toEqual([[1, 5], [2, 6], [3, 7]]);
    expect(m).toMatchObject({ up: 3, thru: 3, remaining: 6 });
  });
  it('a conceded hole goes to the other side whatever the scores; a conceded match ends it', () => {
    const c = { by_side: 2 as const, by: 'b', at: 't' };
    const m = computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, scores([4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4]))]), concessions: [{ ...c, hole: 2 }] }));
    expect(m.holes.map(h => [h.hole, h.winner, h.conceded])).toEqual([[1, null, false], [2, 1, true]]);
    expect(m).toMatchObject({ up: 1, thru: 2, status: 'live' });
    const conceded = computeMatch(base({ concessions: [{ ...c, hole: null }] }));
    expect(conceded).toMatchObject({ status: 'completed', winnerSide: 1, decidedBy: 'concession', result: 'conceded', summary: 'Ann wins · conceded' });
    expect(completionSnapshot(conceded)).toBeNull(); // stored at the concession itself, not at completion
  });
  it('all square after the last → sudden death; the first extra hole won decides ("10 holes"); a halved extra hole asks for the next', () => {
    const square = { sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4, 4, 4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4, 4, 4, 4, 4, 4, 4, 4, 4]))]) };
    const need = computeMatch(base(square));
    expect(need).toMatchObject({ status: 'live', allSquareAfterLast: true, needsExtraHole: true, nextExtraHole: { n: 1, hole_number: 1 }, summary: 'All square after 9 · extra holes' });
    const halvedExtra = computeMatch(base({ ...square, extraHoles: [{ n: 1, hole_number: 1, strokes: { a: 4, b: 4 } }] }));
    expect(halvedExtra).toMatchObject({ needsExtraHole: true, nextExtraHole: { n: 2, hole_number: 2 }, thru: 10 });
    const decided = computeMatch(base({ ...square, extraHoles: [{ n: 1, hole_number: 1, strokes: { a: 4, b: 4 } }, { n: 2, hole_number: 2, strokes: { a: 3, b: 4 } }] }));
    expect(decided).toMatchObject({ status: 'completed', decidedBy: 'extra_holes', winnerSide: 1, result: '11 holes', summary: 'Ann wins · 11 holes', thru: 11 });
    expect(completionSnapshot(decided)).toEqual({ decided_by: 'extra_holes', winner_side: 1, result: '11 holes' });
  });
  it('departed accounts: a written outcome survives a side that lost its player (never re-read as a bye)', () => {
    const erased = computeMatch(base({ sideB: side(2, []), written: { decided_by: 'holes', winner_side: 1, result: '3&2' } }));
    expect(erased).toMatchObject({ status: 'completed', winnerSide: 1, decidedBy: 'holes', result: '3&2', summary: 'Ann wins 3&2' });
    // the WINNER's side emptied: the loser keeps nothing it did not earn
    const winnerGone = computeMatch(base({ sideA: side(1, []), written: { decided_by: 'extra_holes', winner_side: 1, result: '19 holes' } }));
    expect(winnerGone).toMatchObject({ status: 'completed', winnerSide: 1, result: '19 holes' });
    // a written bye stays a bye; no written outcome reads as before
    expect(computeMatch(base({ sideB: side(2, []), written: { decided_by: 'bye', winner_side: 1, result: 'bye' } }))).toMatchObject({ decidedBy: 'bye' });
    expect(computeMatch(base({ sideB: side(2, []), written: null }))).toMatchObject({ decidedBy: 'bye' });
  });

  it('a stored decision wins over the computation; a bye completes at once', () => {
    const m = computeMatch(base({ decision: { decided_by: 'organizer', winner_side: 2 } }));
    expect(m).toMatchObject({ status: 'completed', winnerSide: 2, decidedBy: 'organizer', result: 'decided', summary: 'Bob wins · decided by the organizer' });
    const bye = computeMatch(base({ sideB: side(2, []) }));
    expect(bye).toMatchObject({ status: 'completed', winnerSide: 1, decidedBy: 'bye', result: 'bye', summary: 'Ann · bye' });
  });
});

describe('net match play — strokes given by the difference, on the holes by stroke index', () => {
  it('singles: 100% of the course handicap, the difference to the lower player; a stroke on the holes whose index ≤ the difference', () => {
    const hc = playingHandicaps('singles', 100, side(1, [player('a', 'Ann', 1, [], 10)]), side(2, [player('b', 'Bob', 2, [], 4)]));
    expect(hc).toEqual({ perPlayer: { a: 10, b: 4 }, given: { a: 6, b: 0 }, reason: null });
    // Ann gets a stroke on SI 1..6: a gross tie on holes 1..6 is a net win for Ann; hole 7 halves.
    const m = computeMatch(base({ format: 'match_net', sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4]), 10)]), sideB: side(2, [player('b', 'Bob', 2, scores([4, 4, 4, 4, 4, 4, 4]), 4)]) }));
    expect(m.holes.map(h => h.winner)).toEqual([1, 1, 1, 1, 1, 1, null]);
    expect(m.holes[0].received).toEqual({ a: 1, b: 0 });
    expect(m.holes[0].sideScore).toEqual({ 1: 3, 2: 4 });
    expect(m).toMatchObject({ status: 'completed', result: '6&2', strokesGiven: { a: 6, b: 0 }, netReason: null });
  });
  it('four-ball: 90% per player, each the difference to the lowest of the four; the better net ball counts', () => {
    const A = side(1, [player('a1', 'Ann', 1, scores([5]), 10), player('a2', 'Al', 2, scores([4]), 12)]);
    const B = side(2, [player('b1', 'Bob', 1, scores([4]), 4), player('b2', 'Ben', 2, scores([6]), 8)]);
    const hc = playingHandicaps('fourball', 90, A, B);
    expect(hc.perPlayer).toEqual({ a1: 9, a2: 11, b1: 4, b2: 7 });
    expect(hc.given).toEqual({ a1: 5, a2: 7, b1: 0, b2: 3 });
    const m = computeMatch(base({ format: 'match_net', sides: 'fourball', allowancePct: 90, sideA: A, sideB: B }));
    // Hole 1 (SI 1): Ann 5−1=4, Al 4−1=3 → side 1 counts 3; Bob 4−0=4, Ben 6−1=5 → side 2 counts 4.
    expect(m.holes[0].sideScore).toEqual({ 1: 3, 2: 4 });
    expect(m.holes[0].winner).toBe(1);
  });
  it('foursomes: 50% of the side\'s combined handicaps, the difference to the captain of the higher side; the captain\'s card counts', () => {
    const A = side(1, [player('a1', 'Ann', 1, scores([5]), 10), player('a2', 'Al', 2, scores([1]), 12)]);
    const B = side(2, [player('b1', 'Bob', 1, scores([4]), 4), player('b2', 'Ben', 2, [], 8)]);
    const hc = playingHandicaps('foursomes', 50, A, B);
    expect(hc.perPlayer).toEqual({ a1: 11, a2: 11, b1: 6, b2: 6 });
    expect(hc.given).toEqual({ a1: 5, a2: 0, b1: 0, b2: 0 });
    const m = computeMatch(base({ format: 'match_net', sides: 'foursomes', allowancePct: 50, sideA: A, sideB: B }));
    // Al's card is never read (the captain holds the side's ball): Ann 5−1=4 vs Bob 4 → halved.
    expect(m.holes[0].sideScore).toEqual({ 1: 4, 2: 4 });
    expect(m.holes[0].halved).toBe(true);
  });
  it('a missing index makes the match GROSS with the reason; a missing stroke index too — never a guessed stroke', () => {
    const m = computeMatch(base({ format: 'match_net', sideA: side(1, [player('a', 'Ann', 1, scores([4]), null)]), sideB: side(2, [player('b', 'Bob', 2, scores([4]), 4)]) }));
    expect(m).toMatchObject({ netReason: 'no_index', strokesGiven: {} });
    expect(m.holes[0].halved).toBe(true);
    const noSi = computeMatch(base({ format: 'match_net', holeData: nine.map(h => ({ ...h, handicap: null })), sideA: side(1, [player('a', 'Ann', 1, scores([4]), 10)]), sideB: side(2, [player('b', 'Bob', 2, scores([4]), 4)]) }));
    expect(noSi.netReason).toBe('no_stroke_index');
    expect(noSi.holes[0].halved).toBe(true);
    // A gross match never allocates.
    expect(computeMatch(base({ sideA: side(1, [player('a', 'Ann', 1, scores([4]), 20)]) })).strokesGiven).toEqual({});
  });
});

describe('the groups\' shape and the writes\' rules', () => {
  const m = (id: string, position: number, s: 1 | 2 | null) => ({ participant_id: id, position, side: s });
  it('sidesOf: the side sizes per format; a one-side group is a bye only when allowed', () => {
    expect(sidesOf([m('a', 1, 1), m('b', 2, 2)], 'singles')).toEqual({ ok: true, a: ['a'], b: ['b'], bye: false });
    expect(sidesOf([m('a', 1, 1), m('b', 2, null)], 'singles')).toEqual({ ok: false, reason: 'no_side' });
    expect(sidesOf([m('a', 1, 1)], 'singles')).toEqual({ ok: false, reason: 'wrong_size' });
    expect(sidesOf([m('a', 1, 1)], 'singles', { allowBye: true })).toEqual({ ok: true, a: ['a'], b: [], bye: true });
    expect(sidesOf([m('a', 1, 1), m('b', 2, 1), m('c', 3, 1)], 'fourball')).toEqual({ ok: false, reason: 'too_many' });
    expect(sidesOf([m('a', 1, 1), m('b', 2, 1), m('c', 3, 2), m('d', 4, 2)], 'foursomes')).toEqual({ ok: true, a: ['a', 'b'], b: ['c', 'd'], bye: false });
    expect(sidesOf([], 'singles')).toEqual({ ok: false, reason: 'empty' });
    expect(groupsIncomplete([{ sequence: 1, members: [m('a', 1, 1), m('b', 2, 2)] }, { sequence: 2, members: [m('c', 1, 1)] }], 'singles', false)).toEqual([{ sequence: 2, reason: 'wrong_size' }]);
    expect(groupsIncomplete([{ sequence: 2, members: [m('c', 1, 1)] }], 'singles', true)).toEqual([]);
    expect([1, 2, 3].map(singlesSideFor)).toEqual([1, 2, null]);
  });
  it('concessions: not on a decided match, not off the round, not twice, not on a played hole', () => {
    const input = base({ sideA: side(1, [player('a', 'Ann', 1, scores([4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4]))]), concessions: [{ hole: 3, by_side: 2, by: 'b', at: 't' }] });
    const st = computeMatch(input);
    expect(concessionRefusal(st, input, { hole: 12 })).toBe('hole_outside_round');
    expect(concessionRefusal(st, input, { hole: 3 })).toBe('already_conceded');
    expect(concessionRefusal(st, input, { hole: 1 })).toBe('hole_already_played');
    expect(concessionRefusal(st, input, { hole: 2 })).toBeNull();
    expect(concessionRefusal(st, input, { hole: null })).toBeNull();
    expect(concessionRefusal(computeMatch(base()), base(), { hole: 9 })).toBe('match_decided');
  });
  it('extra holes: only when all square after the last, in order, on the round, for the counting players, with legal strokes', () => {
    const square = base({ sideA: side(1, [player('a', 'Ann', 1, scores([4, 4, 4, 4, 4, 4, 4, 4, 4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4, 4, 4, 4, 4, 4, 4, 4, 4]))]) });
    const st = computeMatch(square);
    expect(extraHoleRefusal(st, square, { n: 1, hole_number: 1, strokes: { a: 4, b: 5 } })).toBeNull();
    expect(extraHoleRefusal(st, square, { n: 2, hole_number: 1, strokes: {} })).toBe('wrong_extra_hole');
    expect(extraHoleRefusal(st, square, { n: 1, hole_number: 15, strokes: {} })).toBe('hole_outside_round');
    expect(extraHoleRefusal(st, square, { n: 1, hole_number: 1, strokes: { zz: 4 } })).toBe('unknown_participant');
    expect(extraHoleRefusal(st, square, { n: 1, hole_number: 1, strokes: { a: 0 } })).toBe('bad_strokes');
    const live = base({ sideA: side(1, [player('a', 'Ann', 1, scores([4]))]), sideB: side(2, [player('b', 'Bob', 2, scores([4]))]) });
    expect(extraHoleRefusal(computeMatch(live), live, { n: 1, hole_number: 1, strokes: {} })).toBe('not_all_square');
  });
});
