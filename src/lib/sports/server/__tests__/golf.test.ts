import { describe, it, expect } from 'vitest';
import { buildGolfStatsTiles } from '../golf';

describe('buildGolfStatsTiles', () => {
  it('returns null for no rounds', () => {
    expect(buildGolfStatsTiles([])).toBeNull();
  });

  it('averages to one decimal, best = min, Rounds counts ALL rounds', () => {
    const card = buildGolfStatsTiles([
      { gross_score: 85, par: 72 },
      { gross_score: 78, par: 72 },
      { gross_score: 92, par: 72 },
    ]);
    expect(card).not.toBeNull();
    expect(card!.label).toBe('Golf Stats');
    expect(card!.tiles).toEqual([
      { label: 'Rounds', value: '3' },
      { label: 'Avg Score', value: '85' }, // (85+78+92)/3 = 85.0 → "85"
      { label: 'Best Score', value: '78' },
    ]);
  });

  it('one-decimal rounding is preserved', () => {
    const card = buildGolfStatsTiles([
      { gross_score: 80, par: 72 },
      { gross_score: 85, par: 72 },
    ]);
    expect(card!.tiles[1].value).toBe('82.5');
  });

  it('null gross_scores are excluded from avg/best but counted as rounds', () => {
    const card = buildGolfStatsTiles([
      { gross_score: 90, par: 72 },
      { gross_score: null, par: 72 },
    ]);
    expect(card!.tiles[0].value).toBe('2');
    expect(card!.tiles[1].value).toBe('90');
    expect(card!.tiles[2].value).toBe('90');
  });

  it('rounds with only null scores show dashes (matches the original branch)', () => {
    const card = buildGolfStatsTiles([{ gross_score: null, par: 72 }]);
    expect(card!.tiles[1].value).toBe('-');
    expect(card!.tiles[2].value).toBe('-');
  });
});
