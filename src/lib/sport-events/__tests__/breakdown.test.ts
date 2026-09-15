import { describe, expect, it } from 'vitest';
import { aggregateBreakdowns, eventHardestHoles, formatAvgOverPar, parMap, playerBreakdown, type BreakdownHole } from '../breakdown';

const holeData = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4][i], handicap: i + 1 }));
const card = (scores: Record<number, Partial<BreakdownHole> | number>): BreakdownHole[] =>
  Object.entries(scores).map(([h, v]) => (typeof v === 'number' ? { hole_number: Number(h), strokes: v } : { hole_number: Number(h), strokes: null, ...v }));
const range18 = { holes: 18 as const, startingHole: 1 as const };

describe('playerBreakdown', () => {
  it('front / back, par buckets, the counts, over the scored holes only', () => {
    const b = playerBreakdown(card({ 1: 4, 2: 5, 3: 2, 4: 5, 5: 4, 6: 6, 7: 3, 8: 5, 9: 4, 10: 4, 11: 3, 12: 7 }), holeData, range18);
    expect(b.played).toBe(12);
    expect(b.gross).toBe(52);
    expect(b.toPar).toBe(4);
    expect(b.front).toEqual({ holes: 9, strokes: 38, toPar: 2 });
    expect(b.back).toEqual({ holes: 3, strokes: 14, toPar: 2 });
    expect(b.byPar[3]).toEqual({ holes: 3, strokes: 8, toPar: -1, avg: 2.67 });
    expect(b.byPar[4]).toEqual({ holes: 6, strokes: 27, toPar: 3, avg: 4.5 });
    expect(b.byPar[5]).toEqual({ holes: 3, strokes: 17, toPar: 2, avg: 5.67 });
    expect(b.byPar[6].holes).toBe(0);
    expect(b.counts).toEqual({ eagle: 0, birdie: 1, par: 8, bogey: 1, doublePlus: 2 });
    expect(b.putts.tracked).toBe(0);
    expect(b.fir.tracked).toBe(0);
  });
  it('putts, fairways (never on a par 3), greens and penalties count only when tracked', () => {
    const b = playerBreakdown(card({
      1: { strokes: 4, putts: 2, fairway_hit: true, green_in_regulation: true },
      2: { strokes: 5, putts: 3, fairway_hit: false, green_in_regulation: false, penalties: ['water'] },
      3: { strokes: 3, putts: 1, fairway_hit: true, green_in_regulation: true }, // a par 3: the fairway is ignored
      4: { strokes: 5 },
    }), holeData, range18);
    expect(b.putts).toEqual({ total: 6, tracked: 3, perHole: 2 });
    expect(b.fir).toEqual({ hit: 1, tracked: 2 });
    expect(b.gir).toEqual({ hit: 2, tracked: 3 });
    expect(b.penalties).toBe(1);
  });
  it('an off-catalog nine from the 10th scores against par 4 over its range; holes outside the range are ignored', () => {
    const b = playerBreakdown(card({ 10: 5, 11: 4, 12: 3, 1: 4 }), null, { holes: 9, startingHole: 10 });
    expect(b.played).toBe(3);
    expect(b.gross).toBe(12);
    expect(b.toPar).toBe(0);
    expect(b.front.holes).toBe(0);
    expect(b.back).toEqual({ holes: 3, strokes: 12, toPar: 0 });
    expect(b.byPar[4]).toEqual({ holes: 3, strokes: 12, toPar: 0, avg: 4 });
    expect([...parMap(null, { holes: 9, startingHole: 10 }).keys()]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(playerBreakdown([], holeData, range18).played).toBe(0);
  });
});

describe('aggregateBreakdowns', () => {
  it('sums the rounds and recomputes the averages', () => {
    const r1 = playerBreakdown(card({ 1: 4, 2: 5, 3: { strokes: 3, putts: 2 } }), holeData, range18);
    const r2 = playerBreakdown(card({ 1: 3, 2: 4, 3: { strokes: 4, putts: 1 } }), holeData, range18);
    const all = aggregateBreakdowns([r1, r2]);
    expect(all.played).toBe(6);
    expect(all.gross).toBe(23);
    expect(all.toPar).toBe(1);
    expect(all.front).toEqual({ holes: 6, strokes: 23, toPar: 1 });
    expect(all.byPar[4]).toEqual({ holes: 4, strokes: 16, toPar: 0, avg: 4 });
    expect(all.byPar[3]).toEqual({ holes: 2, strokes: 7, toPar: 1, avg: 3.5 });
    expect(all.counts).toEqual({ eagle: 0, birdie: 1, par: 3, bogey: 2, doublePlus: 0 });
    expect(all.putts).toEqual({ total: 3, tracked: 2, perHole: 1.5 });
    expect(aggregateBreakdowns([]).played).toBe(0);
  });
});

describe('eventHardestHoles', () => {
  it('the average over par per hole across every card, hardest first, at least two cards on a hole', () => {
    const cards = [
      { holes: card({ 1: 4, 2: 6, 3: 3, 4: 5 }) },
      { holes: card({ 1: 5, 2: 5, 3: 3 }) },
      { holes: card({ 1: 4, 2: 5, 9: 9 }) },
    ];
    const h = eventHardestHoles(cards, holeData, range18);
    expect(h.map(x => [x.hole, x.par, x.avgOverPar, x.tracked])).toEqual([[2, 4, 1.33, 3], [1, 4, 0.33, 3], [3, 3, 0, 2]]);
    expect(eventHardestHoles(cards, holeData, range18, 1).find(x => x.hole === 9)).toEqual({ hole: 9, par: 4, avgOverPar: 5, tracked: 1 });
    expect(eventHardestHoles([], holeData, range18)).toEqual([]);
    expect(formatAvgOverPar(1.33)).toBe('+1.33');
    expect(formatAvgOverPar(0)).toBe('E');
    expect(formatAvgOverPar(-0.5)).toBe('−0.5');
    expect(formatAvgOverPar(0.25)).toBe('+0.25');
  });
});
