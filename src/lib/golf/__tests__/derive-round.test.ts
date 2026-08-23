import { describe, it, expect } from 'vitest';
import { deriveRecordedRound } from '../derive-round';

const player = (holes: Array<[number, number?]>) => ({
  hole_scores: holes.map(([hole_number, strokes]) => ({ hole_number, strokes })),
});

describe('deriveRecordedRound', () => {
  it('front nine only → 9-hole round, holes 1–9', () => {
    expect(deriveRecordedRound([player([[1, 4], [5, 3], [9, 5]])], 18))
      .toEqual({ holesPlayed: 9, startHole: 1, endHole: 9 });
  });

  it('back nine only → 9-hole round, holes 10–18 (numbering survives)', () => {
    expect(deriveRecordedRound([player([[10, 4], [14, 4], [18, 5]])], 18))
      .toEqual({ holesPlayed: 9, startHole: 10, endHole: 18 });
  });

  it('holes on both sides → 18 with partial semantics', () => {
    expect(deriveRecordedRound([player([[8, 4], [11, 4]])], 18))
      .toEqual({ holesPlayed: 18, startHole: 1, endHole: 18 });
  });

  it('a full 18 → 18', () => {
    expect(deriveRecordedRound([player(Array.from({ length: 18 }, (_, i) => [i + 1, 4]))], 18))
      .toEqual({ holesPlayed: 18, startHole: 1, endHole: 18 });
  });

  it('nothing scored (live round) → grid size, full range', () => {
    expect(deriveRecordedRound([player([[1, undefined]])], 18))
      .toEqual({ holesPlayed: 18, startHole: 1, endHole: 18 });
    expect(deriveRecordedRound([], 18))
      .toEqual({ holesPlayed: 18, startHole: 1, endHole: 18 });
  });

  it('9-hole course grid is always a 9-hole round', () => {
    expect(deriveRecordedRound([player([[1, 4]])], 9))
      .toEqual({ holesPlayed: 9, startHole: 1, endHole: 9 });
  });

  it('ANY player extends the union (partner scored the back nine)', () => {
    expect(deriveRecordedRound([player([[3, 4]]), player([[12, 5]])], 18))
      .toEqual({ holesPlayed: 18, startHole: 1, endHole: 18 });
  });
});
