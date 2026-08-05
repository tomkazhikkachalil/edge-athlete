import { describe, it, expect } from 'vitest';
import { taggedSportOptions, taggedYearOptions } from '../tagged/display';

describe('taggedSportOptions', () => {
  it('labels, dedupes, and sorts by display name', () => {
    const options = taggedSportOptions(['volleyball', 'golf', 'golf']);
    expect(options.map(o => o.value)).toEqual(['golf', 'volleyball']);
    expect(options[0].label).toBe('Golf');
  });

  it('falls back to the raw key for unknown sports', () => {
    expect(taggedSportOptions(['quidditch'])[0]).toEqual({ value: 'quidditch', label: 'quidditch' });
  });

  it('returns [] for no sports', () => {
    expect(taggedSportOptions([])).toEqual([]);
  });
});

describe('taggedYearOptions', () => {
  it('dedupes and sorts newest first', () => {
    expect(taggedYearOptions([2023, 2026, 2023, 2025])).toEqual([2026, 2025, 2023]);
  });
});
