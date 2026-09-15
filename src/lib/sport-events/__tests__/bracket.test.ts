import { describe, expect, it } from 'vitest';
import { bracketColumns, bracketFeeders, bracketNextRound, bracketRoundName, bracketRoundsNeeded, bracketWinner, type BracketMatch } from '../bracket';

const m = (sequence: number, a: string[], b: string[], winnerSide: 1 | 2 | null = null): BracketMatch => ({ sequence, groupId: `g${sequence}`, sides: [a, b], winnerSide, decidedBy: winnerSide ? 'holes' : null, result: winnerSide ? '2&1' : null });

describe('the bracket rules', () => {
  it('feeders, names and rounds needed', () => {
    expect(bracketFeeders(1)).toEqual([1, 2]);
    expect(bracketFeeders(3)).toEqual([5, 6]);
    expect([1, 2, 4, 8].map(bracketRoundName)).toEqual(['Final', 'Semifinals', 'Quarterfinals', 'Round of 16']);
    expect([1, 2, 3, 4, 5, 8, 9, 16].map(bracketRoundsNeeded)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it('the next round from the previous: winners of 2k−1 and 2k, an undecided feeder leaves the side empty, an odd tail is a bye', () => {
    const prev = [m(1, ['a'], ['b'], 1), m(2, ['c'], ['d'], 2), m(3, ['e'], ['f'], null), m(4, ['g'], ['h'], 1), m(5, ['i'], ['j'], 2)];
    const next = bracketNextRound(prev);
    expect(next).toEqual([
      { sequence: 1, name: 'Match 1', sides: [['a'], ['d']], feeders: [1, 2] },
      { sequence: 2, name: 'Match 2', sides: [[], ['g']], feeders: [3, 4] },
      { sequence: 3, name: 'Match 3', sides: [['j'], []], feeders: [5, 6] },
    ]);
    // Pairs keep the winners' member order.
    expect(bracketNextRound([m(1, ['a', 'b'], ['c', 'd'], 2), m(2, ['e', 'f'], ['g', 'h'], 1)])[0].sides).toEqual([['c', 'd'], ['e', 'f']]);
    expect(bracketNextRound([])).toEqual([]);
  });
  it('the columns name every empty slot — "TBD" on the first round, "Winner of match n" after — and the Final\'s winner', () => {
    const cols = bracketColumns([
      { id: 'r2', sequence: 2, name: null, status: 'scheduled', matches: [m(1, [], ['d'])] },
      { id: 'r1', sequence: 1, name: 'Round 1', status: 'completed', matches: [m(1, ['a'], ['b'], 1), m(2, [], ['d'], 2)] },
    ]);
    expect(cols.map(c => c.name)).toEqual(['Round 1', 'Final']);
    expect(cols[0].slots[1].sides[0]).toEqual({ members: [], label: 'TBD' });
    expect(cols[1].slots[0].sides).toEqual([{ members: [], label: 'Winner of match 1' }, { members: ['d'], label: null }]);
    expect(bracketWinner(cols)).toBeNull();
    const done = bracketColumns([{ id: 'f', sequence: 1, name: 'Final', status: 'completed', matches: [m(1, ['a'], ['d'], 2)] }]);
    expect(bracketWinner(done)).toEqual({ participantIds: ['d'] });
  });
});
