import { describe, it, expect } from 'vitest';
import {
  getTagOptions,
  getHashtagSuggestions,
  GENERAL_TAG_OPTIONS,
  GENERAL_HASHTAG_SUGGESTIONS,
} from '../post-tags';
import { getEnabledSports } from '../SportRegistry';

describe('getTagOptions / getHashtagSuggestions', () => {
  it('golf returns its registry-declared lists', () => {
    expect(getTagOptions('golf').map(t => t.value)).toContain('tournament');
    expect(getHashtagSuggestions('golf')).toContain('#Golf');
  });

  it('general returns the general defaults', () => {
    expect(getTagOptions('general')).toBe(GENERAL_TAG_OPTIONS);
    expect(getHashtagSuggestions('general')).toBe(GENERAL_HASHTAG_SUGGESTIONS);
  });

  it('a sport without declared lists falls back to general', () => {
    expect(getTagOptions('ice_hockey')).toBe(GENERAL_TAG_OPTIONS);
    expect(getHashtagSuggestions('ice_hockey')).toBe(GENERAL_HASHTAG_SUGGESTIONS);
  });

  it('an unknown key falls back to general (never throws)', () => {
    expect(getTagOptions('not-a-sport')).toBe(GENERAL_TAG_OPTIONS);
    expect(getHashtagSuggestions('')).toBe(GENERAL_HASHTAG_SUGGESTIONS);
  });

  it('every enabled sport resolves non-empty lists', () => {
    for (const sport of getEnabledSports()) {
      expect(getTagOptions(sport.sport_key).length).toBeGreaterThan(0);
      expect(getHashtagSuggestions(sport.sport_key).length).toBeGreaterThan(0);
    }
  });
});
