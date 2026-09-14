import { describe, expect, it } from 'vitest';
import { applyOverride, courseHandicapFor, mergeSnapshot, playedPar, snapshotIndex } from '../handicap';

describe('the frozen index and the computed course handicap', () => {
  it('snapshots the computed index to one decimal, or none', () => {
    expect(snapshotIndex({ diffs: [], series: [], current: { index: 12.34, roundsCounted: 5, diffsUsed: 1 } })).toEqual({ handicap_index: 12.3, handicap_source: 'computed' });
    expect(snapshotIndex({ diffs: [], series: [], current: null })).toEqual({ handicap_index: null, handicap_source: 'none' });
    expect(snapshotIndex(null)).toEqual({ handicap_index: null, handicap_source: 'none' });
  });
  it('an organizer override is kept over a fresh recompute; clearing it returns to none', () => {
    expect(applyOverride(9.96)).toEqual({ handicap_index: 10, handicap_source: 'organizer' });
    expect(applyOverride(null)).toEqual({ handicap_index: null, handicap_source: 'none' });
    expect(mergeSnapshot({ handicap_index: 10, handicap_source: 'organizer' }, { handicap_index: 12.3, handicap_source: 'computed' })).toEqual({ handicap_index: 10, handicap_source: 'organizer' });
    expect(mergeSnapshot({ handicap_index: 12.3, handicap_source: 'computed' }, { handicap_index: 11.1, handicap_source: 'computed' })).toEqual({ handicap_index: 11.1, handicap_source: 'computed' });
  });
  it('the played par sums the round hole data, null on a broken par', () => {
    expect(playedPar([{ hole: 1, par: 4 }, { hole: 2, par: 3 }, { hole: 3, par: 5 }])).toBe(12);
    expect(playedPar([{ hole: 1, par: 4 }, { hole: 2, par: 9 }])).toBeNull();
    expect(playedPar(null)).toBeNull();
  });
  it('course handicap: Rule 6.1a for 18, the index halved for a nine, null on any missing input', () => {
    expect(courseHandicapFor({ handicap_index: 12.3 }, { holes: 18, course_rating: 71.5, slope_rating: 128, par: 72 })).toBe(13); // 12.3*128/113 + (71.5-72) = 13.43
    expect(courseHandicapFor({ handicap_index: 12.3 }, { holes: 9, course_rating: 35.6, slope_rating: 128, par: 36 })).toBe(7); // 6.15*1.1327 - 0.4 = 6.57
    expect(courseHandicapFor({ handicap_index: null }, { holes: 18, course_rating: 71.5, slope_rating: 128, par: 72 })).toBeNull();
    expect(courseHandicapFor({ handicap_index: 12.3 }, { holes: 18, course_rating: null, slope_rating: 128, par: 72 })).toBeNull();
    expect(courseHandicapFor({ handicap_index: 12.3 }, { holes: 18, course_rating: 71.5, slope_rating: 128, par: null })).toBeNull();
  });
});
