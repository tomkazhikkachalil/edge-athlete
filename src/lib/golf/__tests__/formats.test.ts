import { describe, it, expect } from 'vitest';
import {
  asGameFormat,
  stablefordPoints,
  calcStablefordTotal,
  calcMatchStatus,
} from '../formats';

const hole = (hole_number: number, strokes: number | null) => ({ hole_number, strokes });

describe('asGameFormat', () => {
  it('passes valid formats through and defaults everything else to stroke', () => {
    expect(asGameFormat('stableford')).toBe('stableford');
    expect(asGameFormat('match')).toBe('match');
    expect(asGameFormat('stroke')).toBe('stroke');
    expect(asGameFormat('skins')).toBe('stroke');
    expect(asGameFormat(null)).toBe('stroke');
    expect(asGameFormat(undefined)).toBe('stroke');
  });
});

describe('stablefordPoints', () => {
  it('follows the standard allocation on a par 4', () => {
    expect(stablefordPoints(1, 4)).toBe(5); // albatross-or-better band
    expect(stablefordPoints(2, 4)).toBe(4); // eagle
    expect(stablefordPoints(3, 4)).toBe(3); // birdie
    expect(stablefordPoints(4, 4)).toBe(2); // par
    expect(stablefordPoints(5, 4)).toBe(1); // bogey
    expect(stablefordPoints(6, 4)).toBe(0); // double
    expect(stablefordPoints(9, 4)).toBe(0); // worse
  });

  it('gives no points for missing scores', () => {
    expect(stablefordPoints(null, 4)).toBe(0);
    expect(stablefordPoints(undefined, 4)).toBe(0);
    expect(stablefordPoints(0, 4)).toBe(0);
  });
});

describe('calcStablefordTotal', () => {
  it('sums points over scored holes only', () => {
    const { points, holesScored } = calcStablefordTotal(
      [hole(1, 4), hole(2, 3), hole(3, 5), hole(4, null)],
      null // fallback par 4
    );
    // par(2) + birdie(3) + bogey(1)
    expect(points).toBe(6);
    expect(holesScored).toBe(3);
  });

  it('uses course hole pars when available', () => {
    const holeData = [
      { hole: 1, par: 3 },
      { hole: 2, par: 5 },
    ];
    const { points } = calcStablefordTotal([hole(1, 3), hole(2, 4)], holeData);
    // par on the par-3 (2) + birdie on the par-5 (3)
    expect(points).toBe(5);
  });

  it('returns zeros for an empty scorecard', () => {
    expect(calcStablefordTotal([])).toEqual({ points: 0, holesScored: 0 });
  });
});

describe('calcMatchStatus', () => {
  it('reports an in-progress lead ("2 UP thru 3")', () => {
    const a = [hole(1, 4), hole(2, 3), hole(3, 4)];
    const b = [hole(1, 5), hole(2, 4), hole(3, 4)];
    const m = calcMatchStatus(a, b, 18);
    expect(m.diff).toBe(2);
    expect(m.thru).toBe(3);
    expect(m.final).toBe(false);
    expect(m.leaderIndex).toBe(0);
    expect(m.summary).toBe('2 UP thru 3');
  });

  it('reports all square in progress', () => {
    const a = [hole(1, 4), hole(2, 5)];
    const b = [hole(1, 5), hole(2, 4)];
    const m = calcMatchStatus(a, b, 18);
    expect(m.leaderIndex).toBeNull();
    expect(m.summary).toBe('All Square thru 2');
  });

  it('closes out a match early ("3&2")', () => {
    // B wins holes 1-9 and 10-12: 12 contested, A never wins → 12 down… use a
    // realistic close-out instead: 16 contested, B up 3 with 2 to play.
    const a: ReturnType<typeof hole>[] = [];
    const b: ReturnType<typeof hole>[] = [];
    for (let i = 1; i <= 16; i++) {
      // B wins holes 1,2,3; everything else halved
      a.push(hole(i, i <= 3 ? 5 : 4));
      b.push(hole(i, 4));
    }
    const m = calcMatchStatus(a, b, 18);
    expect(m.closedOut).toBe(true);
    expect(m.final).toBe(true);
    expect(m.leaderIndex).toBe(1);
    expect(m.summary).toBe('3&2');
  });

  it('reports a final-hole win ("1 UP") and a halved match', () => {
    const a: ReturnType<typeof hole>[] = [];
    const b: ReturnType<typeof hole>[] = [];
    for (let i = 1; i <= 18; i++) {
      a.push(hole(i, i === 18 ? 3 : 4));
      b.push(hole(i, 4));
    }
    const won = calcMatchStatus(a, b, 18);
    expect(won.final).toBe(true);
    expect(won.summary).toBe('1 UP');
    expect(won.leaderIndex).toBe(0);

    const halvedA = Array.from({ length: 18 }, (_, i) => hole(i + 1, 4));
    const halvedB = Array.from({ length: 18 }, (_, i) => hole(i + 1, 4));
    const halved = calcMatchStatus(halvedA, halvedB, 18);
    expect(halved.final).toBe(true);
    expect(halved.summary).toBe('All Square');
  });

  it('only counts holes both players scored', () => {
    const a = [hole(1, 4), hole(2, 3), hole(3, 4)];
    const b = [hole(1, 5)]; // B has only played hole 1
    const m = calcMatchStatus(a, b, 18);
    expect(m.thru).toBe(1);
    expect(m.summary).toBe('1 UP thru 1');
  });

  it('handles no contested holes', () => {
    const m = calcMatchStatus([], [], 18);
    expect(m.thru).toBe(0);
    expect(m.final).toBe(false);
    expect(m.summary).toBe('Not started');
  });
});
