import { describe, it, expect } from 'vitest';
import {
  validatePenalties,
  sanitizePenalties,
  aggregatePenalties,
  totalPenalties,
  formatPenaltySummary,
} from '../penalties';
import { penaltyColumns, penaltyEntries, totalPenaltyStrokes, validatePenaltyStrokes } from '../penalties';

describe('validatePenalties (strict — scores API 400 path)', () => {
  it('null/undefined/empty → null (no penalties)', () => {
    expect(validatePenalties(null)).toBeNull();
    expect(validatePenalties(undefined)).toBeNull();
    expect(validatePenalties([])).toBeNull();
  });

  it('known types pass through as a copy', () => {
    const input = ['out_of_bounds', 'drop', 'drop'];
    const out = validatePenalties(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('unknown type errors', () => {
    expect(validatePenalties(['out_of_bounds', 'gimme'])).toEqual({
      error: 'Unknown penalty type: gimme',
    });
  });

  it('non-array errors; absurd length errors', () => {
    expect(validatePenalties('drop')).toEqual({ error: 'penalties must be an array' });
    expect(validatePenalties(new Array(21).fill('drop'))).toEqual({
      error: 'Too many penalties for one hole',
    });
  });
});

describe('sanitizePenalties (lenient — bulk/builders)', () => {
  it('filters unknown entries, keeps known', () => {
    expect(sanitizePenalties(['water', 'nonsense', 're_tee'])).toEqual(['water', 're_tee']);
  });

  it('non-array or nothing-valid → null', () => {
    expect(sanitizePenalties('x')).toBeNull();
    expect(sanitizePenalties(['nope'])).toBeNull();
    expect(sanitizePenalties([])).toBeNull();
  });
});

describe('aggregatePenalties / totalPenalties / formatPenaltySummary', () => {
  const arr = ['out_of_bounds', 'drop', 'drop'];

  it('aggregates by type in first-occurrence order', () => {
    expect(aggregatePenalties(arr)).toEqual([
      { type: 'out_of_bounds', count: 1 },
      { type: 'drop', count: 2 },
    ]);
  });

  it('total counts occurrences; empty-safe', () => {
    expect(totalPenalties(arr)).toBe(3);
    expect(totalPenalties(null)).toBe(0);
    expect(totalPenalties([])).toBe(0);
  });

  it('formats the compact summary', () => {
    expect(formatPenaltySummary(arr)).toBe('OB · Drop ×2');
    expect(formatPenaltySummary(null)).toBe('');
  });
});

// Migration 320 (Nov 25 2026): each penalty keeps its own stroke value in a
// second array aligned by index with the types. Descriptive, never scored.
describe('validatePenaltyStrokes — one whole number 1..9 per penalty', () => {
  it('absent or null is "one stroke each"', () => {
    expect(validatePenaltyStrokes(undefined, 2)).toBeNull();
    expect(validatePenaltyStrokes(null, 2)).toBeNull();
  });
  it('all ones is stored as null (the column\'s own spelling of "one each")', () => {
    expect(validatePenaltyStrokes([1, 1], 2)).toBeNull();
  });
  it('keeps real values, as a copy', () => {
    const given = [1, 2, 9];
    const out = validatePenaltyStrokes(given, 3);
    expect(out).toEqual([1, 2, 9]);
    expect(out).not.toBe(given);
  });
  it('refuses a length that does not match the penalties, a value out of range, a fraction, a non-number, a non-array', () => {
    expect(validatePenaltyStrokes([1], 2)).toEqual({ error: 'penalty_strokes must name 2 values, one per penalty' });
    expect(validatePenaltyStrokes([1, 2], 1)).toEqual({ error: 'penalty_strokes must name 1 value, one per penalty' });
    for (const bad of [[0], [10], [1.5], ['2'], [null]]) {
      expect(validatePenaltyStrokes(bad, 1)).toHaveProperty('error');
    }
    expect(validatePenaltyStrokes('2', 1)).toEqual({ error: 'penalty_strokes must be an array' });
  });
  it('no penalties: an empty array is fine, values are not', () => {
    expect(validatePenaltyStrokes([], 0)).toBeNull();
    expect(validatePenaltyStrokes([2], 0)).toEqual({ error: 'penalty_strokes without penalties' });
  });
});

describe('penaltyEntries — the rows of the stack, in the order added', () => {
  it('pairs each type with its strokes', () => {
    expect(penaltyEntries(['out_of_bounds', 'lost_ball'], [1, 2])).toEqual([
      { type: 'out_of_bounds', strokes: 1 },
      { type: 'lost_ball', strokes: 2 },
    ]);
  });
  it('no stroke array (every row before 320) reads one stroke each', () => {
    expect(penaltyEntries(['water', 'drop', 'drop'], null)).toEqual([
      { type: 'water', strokes: 1 }, { type: 'drop', strokes: 1 }, { type: 'drop', strokes: 1 },
    ]);
    expect(penaltyEntries(['water'], undefined)).toEqual([{ type: 'water', strokes: 1 }]);
  });
  it('a mismatch never hides a penalty: a wrong length or a bad value reads one stroke', () => {
    expect(penaltyEntries(['water', 'drop'], [2])).toEqual([{ type: 'water', strokes: 1 }, { type: 'drop', strokes: 1 }]);
    expect(penaltyEntries(['water', 'drop'], [0, 3])).toEqual([{ type: 'water', strokes: 1 }, { type: 'drop', strokes: 3 }]);
  });
  it('an unknown type drops and the others keep their own strokes', () => {
    expect(penaltyEntries(['water', 'meteor', 'drop'], [2, 5, 3])).toEqual([{ type: 'water', strokes: 2 }, { type: 'drop', strokes: 3 }]);
  });
  it('nothing in, nothing out', () => {
    expect(penaltyEntries(null, [1])).toEqual([]);
    expect(penaltyEntries([], null)).toEqual([]);
  });
});

describe('penaltyColumns and totalPenaltyStrokes', () => {
  it('writes the two arrays; strokes is null when every penalty is one stroke', () => {
    expect(penaltyColumns([{ type: 'water', strokes: 1 }, { type: 'drop', strokes: 1 }])).toEqual({ penalties: ['water', 'drop'], penalty_strokes: null });
    expect(penaltyColumns([{ type: 'water', strokes: 1 }, { type: 'lost_ball', strokes: 2 }])).toEqual({ penalties: ['water', 'lost_ball'], penalty_strokes: [1, 2] });
    expect(penaltyColumns([])).toEqual({ penalties: [], penalty_strokes: null });
  });
  it('the badge is the sum of the hole\'s penalty strokes', () => {
    expect(totalPenaltyStrokes(['water', 'lost_ball'], [1, 2])).toBe(3);
    expect(totalPenaltyStrokes(['water', 'drop'], null)).toBe(2);
    expect(totalPenaltyStrokes(null, null)).toBe(0);
  });
  it('round trip: rows → columns → rows', () => {
    const rows = [{ type: 'out_of_bounds' as const, strokes: 2 }, { type: 're_tee' as const, strokes: 1 }];
    const cols = penaltyColumns(rows);
    expect(penaltyEntries(cols.penalties, cols.penalty_strokes)).toEqual(rows);
  });
});
