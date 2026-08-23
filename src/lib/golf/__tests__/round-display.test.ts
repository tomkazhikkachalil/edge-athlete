import { describe, it, expect } from 'vitest';
import { summarizeTrackedStat, trackedStatLabel, holeCountLabel } from '../round-display';

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
