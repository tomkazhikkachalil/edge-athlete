import { describe, it, expect } from 'vitest';
import {
  taggedHeroStats, taggedSportOptions, taggedYearOptions, EMPTY_TAGGED_SUMMARY,
} from '../tagged/display';

describe('taggedHeroStats', () => {
  it('handles the empty summary with honest zeros and no span', () => {
    expect(taggedHeroStats(EMPTY_TAGGED_SUMMARY)).toEqual({
      timesTagged: 0, taggerCount: 0, sportCount: 0, yearsActive: 0, yearSpan: undefined,
    });
  });

  it('computes counts and a span across multiple years', () => {
    const stats = taggedHeroStats({
      timesTagged: 24, taggerCount: 6, sportKeys: ['golf', 'ice_hockey'], years: [2026, 2023, 2025],
    });
    expect(stats).toEqual({
      timesTagged: 24, taggerCount: 6, sportCount: 2, yearsActive: 3, yearSpan: '2023–2026',
    });
  });

  it('omits the span for a single year', () => {
    expect(taggedHeroStats({ ...EMPTY_TAGGED_SUMMARY, years: [2026] }).yearSpan).toBeUndefined();
  });
});

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
