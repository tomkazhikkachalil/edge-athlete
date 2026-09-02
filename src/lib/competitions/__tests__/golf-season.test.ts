import { describe, expect, it } from 'vitest';
import { generateRoundWindows, roundLabel } from '../golf-season';
import { addDaysIso } from '../golf-weeks';

describe('generateRoundWindows — weekly windows from one declaration', () => {
  it('week n starts 7(n−1) days after the start and closes windowDays − 1 later', () => {
    const rounds = generateRoundWindows({ startDate: '2026-09-01', weeks: 3, windowDays: 7, holes: 9 });
    expect(rounds).toEqual([
      { round: 'Week 1', playFrom: '2026-09-01', playTo: '2026-09-07', holes: 9 },
      { round: 'Week 2', playFrom: '2026-09-08', playTo: '2026-09-14', holes: 9 },
      { round: 'Week 3', playFrom: '2026-09-15', playTo: '2026-09-21', holes: 9 },
    ]);
  });
  it('rolls over month and year ends', () => {
    const rounds = generateRoundWindows({ startDate: '2026-12-22', weeks: 3, windowDays: 7, holes: 18 });
    expect(rounds.map(r => [r.playFrom, r.playTo])).toEqual([
      ['2026-12-22', '2026-12-28'],
      ['2026-12-29', '2027-01-04'],
      ['2027-01-05', '2027-01-11'],
    ]);
  });
  it('52 weeks are contiguous and never overlap', () => {
    const rounds = generateRoundWindows({ startDate: '2026-03-01', weeks: 52, windowDays: 7, holes: 9 });
    expect(rounds.length).toBe(52);
    expect(rounds[51].playFrom).toBe('2027-02-21'); // 51 × 7 = 357 days after Mar 1
    for (let i = 1; i < rounds.length; i++) {
      // With a 7-day window the next round opens the day after the last closes.
      expect(rounds[i].playFrom).toBe(addDaysIso(rounds[i - 1].playTo, 1));
    }
  });
  it('a one-day window closes the day it opens; a shorter window leaves a gap', () => {
    const one = generateRoundWindows({ startDate: '2026-09-01', weeks: 2, windowDays: 1, holes: 9 });
    expect(one[0].playTo).toBe(one[0].playFrom);
    expect(one[1].playFrom).toBe('2026-09-08');
    const five = generateRoundWindows({ startDate: '2026-09-01', weeks: 2, windowDays: 5, holes: 9 });
    expect(five[0].playTo).toBe('2026-09-05');
  });
  it('clamps weeks and window days to the bounds', () => {
    expect(generateRoundWindows({ startDate: '2026-09-01', weeks: 99, windowDays: 30, holes: 9 }).length).toBe(52);
    const wide = generateRoundWindows({ startDate: '2026-09-01', weeks: 1, windowDays: 30, holes: 9 });
    expect(wide[0].playTo).toBe('2026-09-14');
    expect(generateRoundWindows({ startDate: '2026-09-01', weeks: 0, windowDays: 0, holes: 9 })).toEqual([
      { round: 'Week 1', playFrom: '2026-09-01', playTo: '2026-09-01', holes: 9 },
    ]);
  });
});

describe('roundLabel', () => {
  it('replaces {n}; a pattern without it gets the number appended', () => {
    expect(roundLabel('Round {n}', 4)).toBe('Round 4');
    expect(roundLabel('Thursday Nine', 4)).toBe('Thursday Nine 4');
    expect(roundLabel('', 2)).toBe('Week 2');
    expect(roundLabel(null, 12)).toBe('Week 12');
  });
  it('stays within the 40-character column and keeps the number', () => {
    const long = roundLabel('An unreasonably long league round label pattern {n}', 12);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith(' 12')).toBe(true);
  });
});
