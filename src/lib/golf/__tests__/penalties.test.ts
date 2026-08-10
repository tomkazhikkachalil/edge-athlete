import { describe, it, expect } from 'vitest';
import {
  validatePenalties,
  sanitizePenalties,
  aggregatePenalties,
  totalPenalties,
  formatPenaltySummary,
} from '../penalties';

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
