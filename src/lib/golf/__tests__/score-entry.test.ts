import { describe, it, expect } from 'vitest';
import { firstUnscoredHole } from '../score-entry';

const scores = (...holes: number[]) => holes.map(hole_number => ({ hole_number }));

describe('firstUnscoredHole', () => {
  it('starts at 1 when nothing is scored', () => {
    expect(firstUnscoredHole([], 18)).toBe(1);
  });

  it('resumes after a contiguous run (holes 1-5 scored → position 6)', () => {
    expect(firstUnscoredHole(scores(1, 2, 3, 4, 5), 18)).toBe(6);
  });

  it('lands on a gap (scored 1-3, skipped 4, scored 5 → position 4)', () => {
    expect(firstUnscoredHole(scores(1, 2, 3, 5), 18)).toBe(4);
  });

  it('lands on the LAST position when everything is scored (edit flow)', () => {
    const all18 = scores(...Array.from({ length: 18 }, (_, i) => i + 1));
    expect(firstUnscoredHole(all18, 18)).toBe(18);
  });

  it('handles back-9 rounds (startingHoleNumber 10; scored 10-12 → position 4)', () => {
    expect(firstUnscoredHole(scores(10, 11, 12), 9, 10)).toBe(4);
  });

  it('handles 9-hole rounds', () => {
    expect(firstUnscoredHole(scores(1, 2), 9)).toBe(3);
    const all9 = scores(...Array.from({ length: 9 }, (_, i) => i + 1));
    expect(firstUnscoredHole(all9, 9)).toBe(9);
  });

  it('ignores scores outside the round window', () => {
    // Front-9 modal shouldn't be confused by (bad) back-9 rows
    expect(firstUnscoredHole(scores(15, 16), 9, 1)).toBe(1);
  });

  it('degrades safely on malformed holesPlayed', () => {
    expect(firstUnscoredHole([], 0)).toBe(1);
  });
});
