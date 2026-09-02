import { describe, expect, it } from 'vitest';
import {
  PGA_POINTS,
  awardRoundPoints,
  parseGolfPointsConfig,
  pointsForPosition,
  previewPoints,
} from '../golf-points';

describe('pointsForPosition', () => {
  it('PGA table: 100 / 75 / 60 …, 30th = 2, everyone after = 1', () => {
    expect(PGA_POINTS).toHaveLength(30);
    expect(pointsForPosition('pga', 1, 40)).toBe(100);
    expect(pointsForPosition('pga', 2, 40)).toBe(75);
    expect(pointsForPosition('pga', 30, 40)).toBe(2);
    expect(pointsForPosition('pga', 31, 40)).toBe(1);
    expect(pointsForPosition('pga', 0, 40)).toBe(0);
  });
  it('linear: last place scores 1, each place up scores one more', () => {
    expect(pointsForPosition('linear', 1, 12)).toBe(12);
    expect(pointsForPosition('linear', 12, 12)).toBe(1);
    expect(pointsForPosition('linear', 13, 12)).toBe(1);
  });
});

describe('awardRoundPoints', () => {
  it('ranks ascending by strokes; unscored entrants get nothing', () => {
    const awards = awardRoundPoints(
      [
        { entry_id: 'b', score: 82 },
        { entry_id: 'a', score: 78 },
        { entry_id: 'c', score: null },
      ],
      'pga'
    );
    expect(awards).toEqual([
      { entry_id: 'a', position: 1, points: 100 },
      { entry_id: 'b', position: 2, points: 75 },
    ]);
  });
  it('a two-way tie for first shares (100 + 75) / 2 = 87.5; the next place is 3rd', () => {
    const awards = awardRoundPoints(
      [
        { entry_id: 'a', score: 78 },
        { entry_id: 'b', score: 78 },
        { entry_id: 'c', score: 80 },
      ],
      'pga'
    );
    expect(awards.map(a => [a.entry_id, a.position, a.points])).toEqual([
      ['a', 1, 87.5],
      ['b', 1, 87.5],
      ['c', 3, 60],
    ]);
  });
  it('a three-way tie for 2nd shares the mean of 2nd–4th', () => {
    const awards = awardRoundPoints(
      [
        { entry_id: 'w', score: 70 },
        { entry_id: 'x', score: 72 },
        { entry_id: 'y', score: 72 },
        { entry_id: 'z', score: 72 },
      ],
      'pga'
    );
    expect(awards.find(a => a.entry_id === 'x')?.points).toBeCloseTo((75 + 60 + 50) / 3, 2);
    expect(awards.filter(a => a.position === 2)).toHaveLength(3);
  });
  it('linear awards by field size', () => {
    const awards = awardRoundPoints(
      [
        { entry_id: 'a', score: 40 },
        { entry_id: 'b', score: 41 },
        { entry_id: 'c', score: 45 },
      ],
      'linear'
    );
    expect(awards.map(a => a.points)).toEqual([3, 2, 1]);
  });
  it('an empty round awards nothing', () => {
    expect(awardRoundPoints([], 'pga')).toEqual([]);
    expect(awardRoundPoints([{ entry_id: 'a', score: null }], 'pga')).toEqual([]);
  });
});

describe('parseGolfPointsConfig + previewPoints', () => {
  it('defaults to the PGA table on net; reads the console shape', () => {
    expect(parseGolfPointsConfig(null)).toEqual({ preset: 'pga', score: 'net' });
    expect(parseGolfPointsConfig({ golf: { pick: 'first', points: 'linear', score: 'gross' } })).toEqual({
      preset: 'linear',
      score: 'gross',
    });
    expect(parseGolfPointsConfig({ golf: { points: 'nope', score: 'nope' } })).toEqual({ preset: 'pga', score: 'net' });
    expect(previewPoints('pga', 3)).toEqual([
      { position: 1, points: 100 },
      { position: 2, points: 75 },
      { position: 3, points: 60 },
    ]);
    expect(previewPoints('linear', 2, 8)).toEqual([
      { position: 1, points: 8 },
      { position: 2, points: 7 },
    ]);
  });
});
