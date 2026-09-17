import { describe, expect, it } from 'vitest';
import { formatLabel, MATCH_SIDES_LABEL } from '../format';
import { formatTeeTimeIn, startTimeLine } from '../format';

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

describe('the round zone (leftovers PR 8) — the venue time and the start line', () => {
  const iso = '2030-06-02T05:00:00.000Z'; // 7:00 PM HST on Jun 1 · 10:00 PM PDT · 1:00 AM EDT on Jun 2
  it('formatTeeTimeIn prints the round\'s clock with its zone name; nothing without a start or a zone', () => {
    expect(formatTeeTimeIn(iso, 'Pacific/Honolulu')).toBe('7:00 PM HST');
    expect(formatTeeTimeIn(iso, null)).toBe('');
    expect(formatTeeTimeIn(null, 'Pacific/Honolulu')).toBe('');
    expect(formatTeeTimeIn('noon', 'Pacific/Honolulu')).toBe('');
    expect(formatTeeTimeIn(iso, 'Mars/Olympus')).toBe('');
  });
  it('startTimeLine: the venue time beside the viewer\'s only when the zones AND the wall clocks differ', () => {
    expect(startTimeLine(iso, 'Pacific/Honolulu', 'America/Los_Angeles')).toBe('7:00 PM HST · 10:00 PM your time');
    expect(startTimeLine(iso, 'Pacific/Honolulu', 'Pacific/Honolulu')).toBe('7:00 PM');
    // The same wall clock in a different zone (Phoenix vs Denver in winter) → the plain time.
    expect(startTimeLine('2030-01-15T02:00:00.000Z', 'America/Phoenix', 'America/Denver')).toBe('7:00 PM');
    expect(startTimeLine(iso, null, 'America/Los_Angeles')).toBe('10:00 PM');
    expect(startTimeLine(null, 'Pacific/Honolulu', 'America/Los_Angeles')).toBe('');
  });
});
