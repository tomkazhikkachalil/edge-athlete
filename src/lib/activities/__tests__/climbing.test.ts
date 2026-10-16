import { describe, expect, it } from 'vitest';
import { CLIMB_GRADES, CLIMB_SCALES, CLIMBS_MAX, climbLine, climbsFrom, gradeRank, summarizeClimbs, validClimb } from '../climbing';

describe('the scales', () => {
  it('run easiest to hardest, with no repeats', () => {
    expect(CLIMB_GRADES.v.slice(0, 3)).toEqual(['VB', 'V0', 'V1']);
    expect(CLIMB_GRADES.v.at(-1)).toBe('V17');
    expect(CLIMB_GRADES.font.slice(0, 6)).toEqual(['3', '4', '4+', '5', '5+', '6A']);
    expect(CLIMB_GRADES.font.at(-1)).toBe('9A');
    expect(CLIMB_GRADES.yds.slice(4, 7)).toEqual(['5.9', '5.10a', '5.10b']);
    expect(CLIMB_GRADES.yds.at(-1)).toBe('5.15d');
    expect(CLIMB_GRADES.french.slice(5, 8)).toEqual(['5c', '6a', '6a+']);
    expect(CLIMB_GRADES.french.at(-1)).toBe('9c+');
    for (const s of CLIMB_SCALES) expect(new Set(CLIMB_GRADES[s]).size).toBe(CLIMB_GRADES[s].length);
    expect(gradeRank('yds', '5.10a')).toBeGreaterThan(gradeRank('yds', '5.9'));
    expect(gradeRank('font', '7A')).toBeGreaterThan(gradeRank('font', '6C+'));
    expect(gradeRank('v', 'V18')).toBe(-1);
  });
});

describe('climbs', () => {
  it('a climb is a grade on its scale, sent or not, with optional tries', () => {
    expect(validClimb('v', { grade: 'V4', sent: true, attempts: 3, at_s: 600 })).toEqual({ grade: 'V4', sent: true, attempts: 3, at_s: 600 });
    expect(validClimb('v', { grade: '5.10a', sent: true })).toBeNull();
    expect(validClimb('v', { grade: 'V4' })).toBeNull();
    expect(validClimb('v', { grade: 'V4', sent: true, attempts: 0 })).toBeNull();
    expect(validClimb('v', { grade: 'V4', sent: true, colour: 'red' })).toBeNull();
  });

  it('a stored list keeps the valid ones, at most 50', () => {
    const many = Array.from({ length: 60 }, () => ({ grade: 'V2', sent: true }));
    expect(climbsFrom('v', many)).toHaveLength(CLIMBS_MAX);
    expect(climbsFrom('v', [{ grade: 'V2', sent: true }, { grade: 'nope', sent: true }])).toHaveLength(1);
    expect(climbsFrom('v', 'x')).toEqual([]);
  });

  it('the hardest SEND ignores attempts', () => {
    const climbs = [
      { grade: 'V3', sent: true },
      { grade: 'V5', sent: false },
      { grade: 'V4', sent: true, attempts: 2 },
    ];
    expect(summarizeClimbs('v', climbs)).toEqual({ climbs: 3, sends: 2, hardest: 'V4' });
    expect(summarizeClimbs('v', [{ grade: 'V5', sent: false }])).toEqual({ climbs: 1, sends: 0, hardest: null });
  });

  it('colours rank only when the gym runs them in order', () => {
    const climbs = [{ grade: 'blue', sent: true }, { grade: 'green', sent: true }, { grade: 'pink', sent: true }];
    expect(summarizeClimbs('colour', climbs).hardest).toBeNull();
    expect(summarizeClimbs('colour', climbs, true).hardest).toBe('blue');
  });

  it('reads a climb as one line', () => {
    expect(climbLine('v', { grade: 'V4', sent: true, attempts: 3 })).toBe('V4 · Sent · 3 tries');
    expect(climbLine('colour', { grade: 'red', sent: false })).toBe('Red · Attempt');
  });
});
