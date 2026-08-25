import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VITALS_PRIVACY,
  parseVitalsPrivacy,
  aspectHidden,
  filterVitalsRows,
} from '../vitals-privacy';

const row = (metric_category: string) => ({ metric_category });

describe('parseVitalsPrivacy', () => {
  it('null/undefined/malformed → all visible (today\'s behavior)', () => {
    expect(parseVitalsPrivacy(null)).toEqual(DEFAULT_VITALS_PRIVACY);
    expect(parseVitalsPrivacy(undefined)).toEqual(DEFAULT_VITALS_PRIVACY);
    expect(parseVitalsPrivacy('nope')).toEqual(DEFAULT_VITALS_PRIVACY);
    expect(parseVitalsPrivacy([true])).toEqual(DEFAULT_VITALS_PRIVACY);
    expect(parseVitalsPrivacy(42)).toEqual(DEFAULT_VITALS_PRIVACY);
  });

  it('reads valid keys, fills the rest false', () => {
    expect(parseVitalsPrivacy({ hidden: true })).toEqual({
      hidden: true, body: false, records: false, workouts: false,
    });
    expect(parseVitalsPrivacy({ body: true, workouts: true })).toEqual({
      hidden: false, body: true, records: false, workouts: true,
    });
  });

  it('drops unknown keys and rejects non-boolean values wholesale', () => {
    const parsed = parseVitalsPrivacy({ hidden: true, evil: 'yes' });
    expect(parsed).toEqual({ hidden: true, body: false, records: false, workouts: false });
    expect('evil' in parsed).toBe(false);
    // A non-boolean value fails validation → safe all-visible default
    expect(parseVitalsPrivacy({ hidden: 'true' })).toEqual(DEFAULT_VITALS_PRIVACY);
  });

  it('returns a fresh object every call (no shared mutable default)', () => {
    const a = parseVitalsPrivacy(null);
    a.hidden = true;
    expect(parseVitalsPrivacy(null).hidden).toBe(false);
  });
});

describe('aspectHidden', () => {
  it('owners always see everything', () => {
    const all = { hidden: true, body: true, records: true, workouts: true };
    expect(aspectHidden(all, 'body', true)).toBe(false);
    expect(aspectHidden(all, 'workouts', true)).toBe(false);
  });

  it('master hidden covers every aspect for non-owners', () => {
    const p = { ...DEFAULT_VITALS_PRIVACY, hidden: true };
    expect(aspectHidden(p, 'body', false)).toBe(true);
    expect(aspectHidden(p, 'records', false)).toBe(true);
    expect(aspectHidden(p, 'workouts', false)).toBe(true);
  });

  it('aspects gate independently', () => {
    const p = { ...DEFAULT_VITALS_PRIVACY, workouts: true };
    expect(aspectHidden(p, 'workouts', false)).toBe(true);
    expect(aspectHidden(p, 'body', false)).toBe(false);
    expect(aspectHidden(p, 'records', false)).toBe(false);
  });
});

describe('filterVitalsRows', () => {
  const rows = [row('body'), row('strength'), row('conditioning'), row('speed')];

  it('owner keeps everything even when all-hidden', () => {
    const all = { hidden: true, body: true, records: true, workouts: true };
    expect(filterVitalsRows(rows, all, true)).toHaveLength(4);
  });

  it('master hidden empties the list for non-owners', () => {
    expect(filterVitalsRows(rows, { ...DEFAULT_VITALS_PRIVACY, hidden: true }, false)).toEqual([]);
  });

  it('body aspect drops only body rows; records drops the rest', () => {
    const bodyOnly = filterVitalsRows(rows, { ...DEFAULT_VITALS_PRIVACY, body: true }, false);
    expect(bodyOnly.map(r => r.metric_category)).toEqual(['strength', 'conditioning', 'speed']);

    const recordsOnly = filterVitalsRows(rows, { ...DEFAULT_VITALS_PRIVACY, records: true }, false);
    expect(recordsOnly.map(r => r.metric_category)).toEqual(['body']);

    const both = filterVitalsRows(
      rows,
      { ...DEFAULT_VITALS_PRIVACY, body: true, records: true },
      false
    );
    expect(both).toEqual([]);
  });

  it('all-visible passes rows through untouched', () => {
    expect(filterVitalsRows(rows, DEFAULT_VITALS_PRIVACY, false)).toHaveLength(4);
  });
});
