import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRAINING_PRIVACY,
  parseTrainingPrivacy,
  aspectHidden,
  filterTrainingRows,
} from '../training-privacy';

const row = (metric_category: string) => ({ metric_category });

describe('parseTrainingPrivacy', () => {
  it('null/undefined/malformed → all visible (today\'s behavior)', () => {
    expect(parseTrainingPrivacy(null)).toEqual(DEFAULT_TRAINING_PRIVACY);
    expect(parseTrainingPrivacy(undefined)).toEqual(DEFAULT_TRAINING_PRIVACY);
    expect(parseTrainingPrivacy('nope')).toEqual(DEFAULT_TRAINING_PRIVACY);
    expect(parseTrainingPrivacy([true])).toEqual(DEFAULT_TRAINING_PRIVACY);
    expect(parseTrainingPrivacy(42)).toEqual(DEFAULT_TRAINING_PRIVACY);
  });

  it('reads valid keys, fills the rest false', () => {
    expect(parseTrainingPrivacy({ hidden: true })).toEqual({
      hidden: true, body: false, records: false, workouts: false,
    });
    expect(parseTrainingPrivacy({ body: true, workouts: true })).toEqual({
      hidden: false, body: true, records: false, workouts: true,
    });
  });

  it('drops unknown keys and rejects non-boolean values wholesale', () => {
    const parsed = parseTrainingPrivacy({ hidden: true, evil: 'yes' });
    expect(parsed).toEqual({ hidden: true, body: false, records: false, workouts: false });
    expect('evil' in parsed).toBe(false);
    // A non-boolean value fails validation → safe all-visible default
    expect(parseTrainingPrivacy({ hidden: 'true' })).toEqual(DEFAULT_TRAINING_PRIVACY);
  });

  it('returns a fresh object every call (no shared mutable default)', () => {
    const a = parseTrainingPrivacy(null);
    a.hidden = true;
    expect(parseTrainingPrivacy(null).hidden).toBe(false);
  });
});

describe('aspectHidden', () => {
  it('owners always see everything', () => {
    const all = { hidden: true, body: true, records: true, workouts: true };
    expect(aspectHidden(all, 'body', true)).toBe(false);
    expect(aspectHidden(all, 'workouts', true)).toBe(false);
  });

  it('master hidden covers every aspect for non-owners', () => {
    const p = { ...DEFAULT_TRAINING_PRIVACY, hidden: true };
    expect(aspectHidden(p, 'body', false)).toBe(true);
    expect(aspectHidden(p, 'records', false)).toBe(true);
    expect(aspectHidden(p, 'workouts', false)).toBe(true);
  });

  it('aspects gate independently', () => {
    const p = { ...DEFAULT_TRAINING_PRIVACY, workouts: true };
    expect(aspectHidden(p, 'workouts', false)).toBe(true);
    expect(aspectHidden(p, 'body', false)).toBe(false);
    expect(aspectHidden(p, 'records', false)).toBe(false);
  });
});

describe('filterTrainingRows', () => {
  const rows = [row('body'), row('strength'), row('conditioning'), row('speed')];

  it('owner keeps everything even when all-hidden', () => {
    const all = { hidden: true, body: true, records: true, workouts: true };
    expect(filterTrainingRows(rows, all, true)).toHaveLength(4);
  });

  it('master hidden empties the list for non-owners', () => {
    expect(filterTrainingRows(rows, { ...DEFAULT_TRAINING_PRIVACY, hidden: true }, false)).toEqual([]);
  });

  it('body aspect drops only body rows; records drops the rest', () => {
    const bodyOnly = filterTrainingRows(rows, { ...DEFAULT_TRAINING_PRIVACY, body: true }, false);
    expect(bodyOnly.map(r => r.metric_category)).toEqual(['strength', 'conditioning', 'speed']);

    const recordsOnly = filterTrainingRows(rows, { ...DEFAULT_TRAINING_PRIVACY, records: true }, false);
    expect(recordsOnly.map(r => r.metric_category)).toEqual(['body']);

    const both = filterTrainingRows(
      rows,
      { ...DEFAULT_TRAINING_PRIVACY, body: true, records: true },
      false
    );
    expect(both).toEqual([]);
  });

  it('all-visible passes rows through untouched', () => {
    expect(filterTrainingRows(rows, DEFAULT_TRAINING_PRIVACY, false)).toHaveLength(4);
  });
});
