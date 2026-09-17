import { describe, expect, it } from 'vitest';
import { bracketColumnsFromContests, bracketDraw, bracketFill, bracketOrder, computeBracketStandings, seedsRefusal, type BracketContestRow } from '../bracket-draw';

const seeded = (n: number) => Array.from({ length: n }, (_, i) => ({ entryId: `e${i + 1}`, seed: i + 1 }));

describe('bracketOrder — the classic placement', () => {
  it('keeps 1 and 2 in opposite halves', () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('bracketDraw — byes are never contests; the survivor is pre-filled downstream', () => {
  it('five seeds: a field of 8, one real first-round contest, three byes pre-filled into the semifinals', () => {
    const d = bracketDraw(seeded(5));
    expect(d.size).toBe(8);
    expect(d.stages).toBe(3);
    expect(d.byes.sort()).toEqual(['e1', 'e2', 'e3']);
    const s1 = d.contests.filter(c => c.stage === 1);
    expect(s1).toEqual([{ stage: 1, slot: 2, round: 'Quarterfinals', home: 'e4', away: 'e5' }]);
    const s2 = d.contests.filter(c => c.stage === 2);
    expect(s2).toEqual([
      { stage: 2, slot: 1, round: 'Semifinals', home: 'e1', away: null },
      { stage: 2, slot: 2, round: 'Semifinals', home: 'e2', away: 'e3' },
    ]);
    expect(d.contests.filter(c => c.stage === 3)).toEqual([{ stage: 3, slot: 1, round: 'Final', home: null, away: null }]);
  });
  it('four seeds: two semifinals and a final, no byes; two seeds: a final; one seed: nothing', () => {
    const d4 = bracketDraw(seeded(4));
    expect(d4.byes).toEqual([]);
    expect(d4.contests.map(c => [c.stage, c.slot, c.home, c.away])).toEqual([[1, 1, 'e1', 'e4'], [1, 2, 'e2', 'e3'], [2, 1, null, null]]);
    expect(bracketDraw(seeded(2)).contests).toEqual([{ stage: 1, slot: 1, round: 'Final', home: 'e1', away: 'e2' }]);
    expect(bracketDraw(seeded(1)).contests).toEqual([]);
  });
});

describe('bracketFill — by slot, never by id; a slot with a result is never touched', () => {
  const rows: BracketContestRow[] = [
    { id: 'c12', stage: 1, slot: 2, status: 'completed', home: 'e4', away: 'e5', winnerEntryId: 'e5', hasResult: true },
    { id: 'c21', stage: 2, slot: 1, status: 'scheduled', home: 'e1', away: null, winnerEntryId: null, hasResult: false },
    { id: 'c22', stage: 2, slot: 2, status: 'scheduled', home: 'e3', away: 'e2', winnerEntryId: null, hasResult: false },
    { id: 'c31', stage: 3, slot: 1, status: 'scheduled', home: null, away: null, winnerEntryId: null, hasResult: false },
  ];
  it('fills the semifinal from the quarterfinal winner; a bye-filled side has no feeder and stays', () => {
    expect(bracketFill(rows)).toEqual([{ contestId: 'c21', side: 'away', entryId: 'e5' }]);
  });
  it('a changed feeder winner re-points downstream while downstream has no result; a downstream result freezes it', () => {
    const filled = rows.map(r => (r.id === 'c21' ? { ...r, away: 'e5' } : r));
    expect(bracketFill(filled)).toEqual([]);
    const changed = filled.map(r => (r.id === 'c12' ? { ...r, winnerEntryId: 'e4' } : r));
    expect(bracketFill(changed)).toEqual([{ contestId: 'c21', side: 'away', entryId: 'e4' }]);
    const frozen = changed.map(r => (r.id === 'c21' ? { ...r, hasResult: true } : r));
    expect(bracketFill(frozen)).toEqual([]);
    // An undecided feeder clears a stale downstream side.
    const undecided = filled.map(r => (r.id === 'c12' ? { ...r, winnerEntryId: null, hasResult: false } : r));
    expect(bracketFill(undecided)).toEqual([{ contestId: 'c21', side: 'away', entryId: null }]);
  });
});

describe('computeBracketStandings — the progression', () => {
  it('champion 1, runner-up 2, semifinal losers share 3, the first-round loser 5', () => {
    const rows: BracketContestRow[] = [
      { id: 'c12', stage: 1, slot: 2, status: 'completed', home: 'e4', away: 'e5', winnerEntryId: 'e5', hasResult: true },
      { id: 'c21', stage: 2, slot: 1, status: 'completed', home: 'e1', away: 'e5', winnerEntryId: 'e1', hasResult: true },
      { id: 'c22', stage: 2, slot: 2, status: 'completed', home: 'e3', away: 'e2', winnerEntryId: 'e2', hasResult: true },
      { id: 'c31', stage: 3, slot: 1, status: 'completed', home: 'e1', away: 'e2', winnerEntryId: 'e2', hasResult: true },
    ];
    const s = computeBracketStandings(['e1', 'e2', 'e3', 'e4', 'e5'], rows);
    expect(s.map(r => [r.entry_id, r.rank])).toEqual([['e2', 1], ['e1', 2], ['e5', 3], ['e3', 3], ['e4', 5]]);
    expect(s[0]).toMatchObject({ points: null, played: 2, stats: { reached: 3, w: 2, l: 0 } });
    expect(s[4]).toMatchObject({ played: 1, stats: { reached: 1, w: 0, l: 1 } });
  });
  it('before any result everyone shares the top; an entry never drawn is last', () => {
    const rows: BracketContestRow[] = [{ id: 'c11', stage: 1, slot: 1, status: 'scheduled', home: 'e1', away: 'e2', winnerEntryId: null, hasResult: false }];
    expect(computeBracketStandings(['e1', 'e2', 'e9'], rows).map(r => [r.entry_id, r.rank])).toEqual([['e1', 1], ['e2', 1], ['e9', 3]]);
  });
  it('the columns view names every slot, a missing slot reads as a bye', () => {
    const cols = bracketColumnsFromContests([{ id: 'c12', stage: 1, slot: 2, status: 'completed', home: 'e4', away: 'e5', winnerEntryId: 'e5', hasResult: true }, { id: 'c21', stage: 2, slot: 1, status: 'scheduled', home: 'e1', away: 'e5', winnerEntryId: null, hasResult: false }], id => id.toUpperCase());
    expect(cols.map(c => c.name)).toEqual(['Semifinals', 'Final']);
    expect(cols[0].slots[0]).toMatchObject({ slot: 1, contestId: null, status: 'bye' });
    expect(cols[0].slots[1]).toMatchObject({ contestId: 'c12', home: { name: 'E4' }, winnerEntryId: 'e5' });
  });
});

describe('seedsRefusal', () => {
  const entries = [{ id: 'a', status: 'approved' }, { id: 'b', status: 'approved' }, { id: 'p', status: 'pending' }];
  it('the full order of approved entries, once each, before the draw', () => {
    expect(seedsRefusal(['a', 'b'], entries, false)).toBeNull();
    expect(seedsRefusal(['a', 'a'], entries, false)).toBe('duplicate');
    expect(seedsRefusal(['a', 'x'], entries, false)).toBe('missing');
    expect(seedsRefusal(['a', 'p'], entries, false)).toBe('not_approved');
    expect(seedsRefusal(['a', 'b'], entries, true)).toBe('bracket_drawn');
  });
});
