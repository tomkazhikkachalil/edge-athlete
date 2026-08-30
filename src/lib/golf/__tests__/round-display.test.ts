import { describe, it, expect } from 'vitest';
import { summarizeTrackedStat, trackedStatLabel, holeCountLabel, holeCountValue, playedHoleCount } from '../round-display';

describe('summarizeTrackedStat', () => {
  it('all-null column is untracked, not 0-for-N', () => {
    expect(summarizeTrackedStat([null, null, undefined])).toEqual({ hit: 0, tracked: 0 });
  });

  it('mixed column uses tracked as the denominator', () => {
    // 9 holes, greens tracked on 5, hit on 3 → 3/5, never 3/9
    expect(summarizeTrackedStat([true, null, false, true, null, true, false, null, null]))
      .toEqual({ hit: 3, tracked: 5 });
  });

  it('an explicit false is a tracked miss', () => {
    expect(summarizeTrackedStat([false, false])).toEqual({ hit: 0, tracked: 2 });
  });
});

describe('trackedStatLabel', () => {
  it('renders em-dash for untracked and hit/tracked otherwise', () => {
    expect(trackedStatLabel([null, null])).toBe('—');
    expect(trackedStatLabel([true, false, null])).toBe('1/2');
  });
});

describe('holeCountLabel', () => {
  it('partial rounds say how far they got', () => {
    expect(holeCountLabel(9, 18)).toBe('9 of 18 holes');
  });
  it('complete rounds name the configured length', () => {
    expect(holeCountLabel(18, 18)).toBe('18 holes');
    expect(holeCountLabel(9, 9)).toBe('9 holes');
  });
  it('zero played falls back to configured (no hole data recorded)', () => {
    expect(holeCountLabel(0, 18)).toBe('18 holes');
  });
});

describe('playedHoleCount', () => {
  const h = (hole_number: number, strokes: number | null) => ({ hole_number, strokes });

  it('counts the holes actually scored, not the configured length', () => {
    expect(playedHoleCount(Array.from({ length: 13 }, (_, i) => h(i + 1, 4)))).toBe(13);
  });

  it('unions across participants — the round is what the GROUP played', () => {
    // Two players, overlapping holes: the extent is 1-3, not 5 rows.
    expect(playedHoleCount([h(1, 4), h(2, 5), h(1, 6), h(2, 4), h(3, 3)])).toBe(3);
  });

  it('a row without strokes is not a played hole', () => {
    // golf_holes.strokes is NULLABLE — a row can exist for an unscored hole.
    expect(playedHoleCount([h(1, 4), h(2, null), h(3, 0)])).toBe(1);
  });

  it('no hole rows is 0, which holeCountLabel renders as the configured length', () => {
    // The quick-entry round: a gross score and no hole detail at all.
    expect(playedHoleCount([])).toBe(0);
    expect(playedHoleCount(null)).toBe(0);
    expect(holeCountLabel(playedHoleCount([]), 18)).toBe('18 holes');
  });

  it('a complete round names its length rather than counting up to it', () => {
    const full = Array.from({ length: 18 }, (_, i) => h(i + 1, 4));
    expect(holeCountLabel(playedHoleCount(full), 18)).toBe('18 holes');
  });

  it('a partial round says how far it got', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => h(i + 1, 4));
    expect(holeCountLabel(playedHoleCount(thirteen), 18)).toBe('13 of 18 holes');
  });

  it('a back-nine round counts 9, not 18 — holes are numbered 10-18', () => {
    const back9 = Array.from({ length: 9 }, (_, i) => h(i + 10, 4));
    expect(playedHoleCount(back9)).toBe(9);
    expect(holeCountLabel(playedHoleCount(back9), 9)).toBe('9 holes');
  });
});

describe('holeCountValue', () => {
  it('gives the bare count for a tile that labels itself', () => {
    expect(holeCountValue(13, 18)).toBe('13 of 18');
    expect(holeCountValue(18, 18)).toBe('18');
    expect(holeCountValue(0, 18)).toBe('18');
  });

  it('never says "20 of 18" — more rows than the round claims is just the count', () => {
    // Reachable on the solo detail page, where hole rows can outnumber
    // golf_rounds.holes.
    expect(holeCountValue(20, 18)).toBe('20');
    expect(holeCountLabel(20, 18)).toBe('20 holes');
  });
});
