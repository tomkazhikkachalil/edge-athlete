import { describe, it, expect } from 'vitest';
import { escapeLikePattern, likePatternFor } from '../patterns';
import { WIDE_MATCH_MIN_CHARS } from '../people';

describe('escapeLikePattern', () => {
  it('escapes the LIKE wildcards', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslashes first, so escapes are not double-escaped', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    // A backslash followed by a wildcard: both escaped exactly once.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('Pebble Beach')).toBe('Pebble Beach');
  });
});

describe('likePatternFor', () => {
  it('is PREFIX-only below the wide-match threshold', () => {
    expect(likePatternFor('a')).toBe('a%');
    expect(likePatternFor('au')).toBe('au%');
    expect('au'.length).toBeLessThan(WIDE_MATCH_MIN_CHARS);
  });

  it('becomes a substring match at the threshold', () => {
    expect('aug'.length).toBe(WIDE_MATCH_MIN_CHARS);
    expect(likePatternFor('aug')).toBe('%aug%');
    expect(likePatternFor('augusta')).toBe('%augusta%');
  });

  it('trims before measuring, so padding cannot flip the rule', () => {
    expect(likePatternFor('  a  ')).toBe('a%');
    expect(likePatternFor('  aug  ')).toBe('%aug%');
  });

  it('escapes wildcards in both branches', () => {
    expect(likePatternFor('%')).toBe('\\%%');
    expect(likePatternFor('a%b')).toBe('%a\\%b%');
  });

  it('matches everything for an empty query', () => {
    expect(likePatternFor('')).toBe('%');
    expect(likePatternFor('   ')).toBe('%');
  });
});
