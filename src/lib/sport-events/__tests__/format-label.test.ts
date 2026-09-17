import { describe, expect, it } from 'vitest';
import { formatLabel, MATCH_SIDES_LABEL } from '../format';

describe('formatLabel — exhaustive over the six formats (phase 3 + the Stableford leftover)', () => {
  it('names the play, the sides and gross / net, and a bracket', () => {
    expect(formatLabel('stableford_gross')).toBe('Stableford · Gross');
    expect(formatLabel('stableford_net')).toBe('Stableford · Net');
    expect(formatLabel('stroke_gross')).toBe('Stroke play · Gross');
    expect(formatLabel('stroke_net')).toBe('Stroke play · Net');
    expect(formatLabel('match_gross')).toBe('Match play · Singles · Gross');
    expect(formatLabel('match_net', { sides: 'fourball', bracket: false })).toBe('Match play · Four-ball · Net');
    expect(formatLabel('match_gross', { sides: 'foursomes', bracket: true })).toBe('Match play · Foursomes · Gross · Bracket');
    expect(formatLabel('stroke_gross', { sides: 'fourball', bracket: true })).toBe('Stroke play · Gross'); // a stroke format ignores a stray match config
    expect(Object.keys(MATCH_SIDES_LABEL)).toEqual(['singles', 'fourball', 'foursomes']);
  });
});
