import { describe, expect, it } from 'vitest';
import { computeLeaderboard, formatRank, formatThru, formatToPar, type LeaderboardInput, type LeaderboardPlayer } from '../leaderboard';

const holeData = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4][i], yardage: 400, handicap: [7, 13, 17, 1, 9, 3, 15, 5, 11, 8, 18, 2, 10, 4, 16, 6, 12, 14][i] }));
const card = (strokesByHole: Record<number, number>) => Object.entries(strokesByHole).map(([h, s]) => ({ hole_number: Number(h), strokes: s }));
const player = (id: string, holeScores: LeaderboardPlayer['holeScores'], handicapIndex: number | null = null, cardStatus: LeaderboardPlayer['cardStatus'] = 'in_progress'): LeaderboardPlayer => ({ participantId: id, profileId: `pf-${id}`, name: id.toUpperCase(), handle: null, handicapIndex, holeScores, cardStatus });
const input = (players: LeaderboardPlayer[], over: Partial<LeaderboardInput> = {}): LeaderboardInput => ({ format: 'stroke_gross', holes: 18, holeData, courseRating: 71.5, slopeRating: 128, players, ...over });

describe('formatting', () => {
  it('T2, F, E / +3 / −2', () => {
    expect(formatRank(1, false)).toBe('1');
    expect(formatRank(2, true)).toBe('T2');
    expect(formatRank(null, false)).toBe('—');
    expect(formatThru(0, 18)).toBe('—');
    expect(formatThru(7, 18)).toBe('7');
    expect(formatThru(18, 18)).toBe('F');
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(3)).toBe('+3');
    expect(formatToPar(-2)).toBe('−2');
    expect(formatToPar(null)).toBe('—');
  });
});

describe('computeLeaderboard', () => {
  it('gross: sums over scored holes, to-par honest on a partial card, ties share a rank and print T2, unscored last', () => {
    const rows = computeLeaderboard(input([
      player('a', card({ 1: 4, 2: 4, 3: 3 })),                       // E thru 3
      player('b', card({ 1: 5, 2: 4, 3: 3 })),                       // +1 thru 3
      player('c', card({ 1: 5, 2: 4, 3: 3 })),                       // +1 thru 3 — tie with b
      player('d', card({ 1: 3, 2: 4 })),                             // −1 thru 2, gross 7 — the lowest gross
      player('e', []),
    ]));
    expect(rows.map(r => [r.name, r.rankLabel, r.thru, r.gross, r.toPar])).toEqual([
      ['D', '1', 2, 7, -1],
      ['A', '2', 3, 11, 0],
      ['B', 'T3', 3, 12, 1],
      ['C', 'T3', 3, 12, 1],
      ['E', '—', 0, null, null],
    ]);
  });
  it('net: allocates strokes per scored hole from the re-ranked stroke index, reasons when it cannot', () => {
    // 12.3 index → CH 13 on this tee/par: one stroke on SI 1..13. Holes 1 (SI 7), 2 (SI 13), 3 (SI 17) → 2 strokes.
    const rows = computeLeaderboard(input([
      player('a', card({ 1: 4, 2: 4, 3: 3 }), 12.3),
      player('b', card({ 1: 4, 2: 4, 3: 3 }), null),
    ], { format: 'stroke_net' }));
    const a = rows.find(r => r.name === 'A')!;
    expect(a).toMatchObject({ courseHandicap: 13, gross: 11, net: 9, toPar: 0, netToPar: -2, netReason: null, rankLabel: '1' });
    const b = rows.find(r => r.name === 'B')!;
    expect(b).toMatchObject({ net: null, netReason: 'no_index', rank: null, rankLabel: '—' });
  });
  it('net: a scored hole without a stroke index answers no_stroke_index; no rating answers no_rating', () => {
    const noSi = holeData.map(h => (h.hole === 2 ? { ...h, handicap: null } : h));
    const rows = computeLeaderboard(input([player('a', card({ 1: 4, 2: 4 }), 12.3)], { format: 'stroke_net', holeData: noSi }));
    expect(rows[0]).toMatchObject({ net: null, netReason: 'no_stroke_index' });
    const rows2 = computeLeaderboard(input([player('a', card({ 1: 4 }), 12.3)], { format: 'stroke_net', slopeRating: null }));
    expect(rows2[0]).toMatchObject({ net: null, netReason: 'no_rating' });
  });
  it('a nine from the tenth: only the played holes count, and the re-ranked indexes allocate as 1..9', () => {
    const back = holeData.slice(9); // holes 10..18
    const rows = computeLeaderboard(input([player('a', card({ 10: 5, 11: 4 }), 18.0)], { format: 'stroke_net', holes: 9, holeData: back, courseRating: 35.6, slopeRating: 128 }));
    // index halved 9.0 → CH round(9*128/113 + (35.6-36)) = round(10.19-0.4) = 10 → every hole gets a stroke, SI ≤ 10 mod 18 = 10: all 9 re-ranked indexes 1..9 get one → net = gross − 2
    expect(rows[0]).toMatchObject({ courseHandicap: 10, gross: 9, net: 7, thru: 2 });
  });
  it('an off-catalog round (no hole data) scores against par 4 over its range; net stays unavailable', () => {
    const rows = computeLeaderboard(input([player('a', card({ 10: 5, 11: 3 }), 12.3), player('b', card({ 10: 4 }))], { format: 'stroke_gross', holes: 9, startingHole: 10, holeData: null, courseRating: null, slopeRating: null }));
    expect(rows.map(r => [r.name, r.rankLabel, r.gross, r.toPar, r.thru, r.net, r.netReason])).toEqual([
      ['B', '1', 4, 0, 1, null, 'no_index'],
      ['A', '2', 8, 0, 2, null, 'no_rating'],
    ]);
    // A net event on an unrated course ranks nobody — net is never guessed.
    const net = computeLeaderboard(input([player('a', card({ 10: 5 }), 12.3)], { format: 'stroke_net', holes: 9, startingHole: 10, holeData: null, courseRating: null, slopeRating: null }));
    expect(net[0]).toMatchObject({ rankLabel: '—', gross: 5, net: null, netReason: 'no_rating' });
    // A hole outside the range is not on the card.
    expect(computeLeaderboard(input([player('a', card({ 3: 4 }))], { holes: 9, startingHole: 10, holeData: null }))[0].thru).toBe(0);
  });
});
