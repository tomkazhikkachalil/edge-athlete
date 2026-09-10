import { describe, expect, it } from 'vitest';
import { normalizeShortlistNote, shortlistedByLabel, SHORTLIST_NOTE_MAX } from '../shortlist';

describe('normalizeShortlistNote', () => {
  it('trims, empties to null, clips to the CHECK, ignores non-strings', () => {
    expect(normalizeShortlistNote('  strong left side  ')).toBe('strong left side');
    expect(normalizeShortlistNote('   ')).toBeNull();
    expect(normalizeShortlistNote(null)).toBeNull();
    expect(normalizeShortlistNote(42)).toBeNull();
    expect(normalizeShortlistNote('x'.repeat(SHORTLIST_NOTE_MAX + 50))).toHaveLength(SHORTLIST_NOTE_MAX);
  });
});

describe('shortlistedByLabel', () => {
  it('counts only, never names', () => {
    expect(shortlistedByLabel(0)).toBeNull();
    expect(shortlistedByLabel(1)).toBe('Shortlisted by 1 scout');
    expect(shortlistedByLabel(3)).toBe('Shortlisted by 3 scouts');
    expect(shortlistedByLabel(Number.NaN)).toBeNull();
  });
});
