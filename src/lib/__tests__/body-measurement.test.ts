import { describe, it, expect } from 'vitest';
import {
  convertHeight,
  convertWeight,
  isNewestEntry,
  isValidRecordedDate,
} from '../body-measurement';

describe('convertHeight', () => {
  it('converts whole-inch heights cleanly', () => {
    // 5'10" entered via Edit Profile → round(70 × 2.54) = 178cm
    expect(convertHeight(178)).toEqual({ valueIn: 70.1, display: `5'10"` });
    // 6'0" → 183cm
    expect(convertHeight(183)).toEqual({ valueIn: 72, display: `6'0"` });
  });

  it('never renders 12 inches (the floor/round split edge)', () => {
    // 182.5cm = 71.85in — naive floor(feet)+round(remainder) yields 5'12"
    expect(convertHeight(182.5).display).toBe(`6'0"`);
  });

  it('handles a small athlete', () => {
    // 4'2" → round(50 × 2.54) = 127cm
    expect(convertHeight(127)).toEqual({ valueIn: 50, display: `4'2"` });
  });
});

describe('convertWeight', () => {
  it('lbs passthrough', () => {
    expect(convertWeight(152.5, 'lbs')).toEqual({
      valueLbs: 152.5,
      valueKg: 69.17, // 152.5 × 0.453592 = 69.1728 → 2dp
      displayText: '152.5 lbs',
    });
  });

  it('kg: timeline lbs converted, kg passthrough unrounded (route parity)', () => {
    expect(convertWeight(70, 'kg')).toEqual({
      valueLbs: 154.3, // 70 × 2.20462 = 154.3234 → 1dp
      valueKg: 70,
      displayText: '70 kg',
    });
  });

  it('stone: ×14 lbs, ×6.35029 kg, "st" display', () => {
    expect(convertWeight(11, 'stone')).toEqual({
      valueLbs: 154,
      valueKg: 69.85, // 11 × 6.35029 = 69.853 → 2dp
      displayText: '11 st',
    });
  });
});

describe('isNewestEntry', () => {
  it('first-ever entry is always newest', () => {
    expect(isNewestEntry('2020-01-01', null)).toBe(true);
  });
  it('later date wins, earlier loses', () => {
    expect(isNewestEntry('2026-08-10', '2026-08-01')).toBe(true);
    expect(isNewestEntry('2026-07-31', '2026-08-01')).toBe(false);
  });
  it('same-day tie goes to the new entry (correction semantics)', () => {
    expect(isNewestEntry('2026-08-10', '2026-08-10')).toBe(true);
  });
});

describe('isValidRecordedDate', () => {
  const now = new Date('2026-08-10T12:00:00Z');

  it('accepts today and the past', () => {
    expect(isValidRecordedDate('2026-08-10', now)).toBe(true);
    expect(isValidRecordedDate('2020-02-29', now)).toBe(true); // real leap day
  });
  it('tolerates one day of timezone skew but no more', () => {
    expect(isValidRecordedDate('2026-08-11', now)).toBe(true);
    expect(isValidRecordedDate('2026-08-12', now)).toBe(false);
  });
  it('rejects malformed and impossible dates', () => {
    expect(isValidRecordedDate('08/10/2026', now)).toBe(false);
    expect(isValidRecordedDate('2026-8-10', now)).toBe(false);
    expect(isValidRecordedDate('2026-02-30', now)).toBe(false);
    expect(isValidRecordedDate('2025-02-29', now)).toBe(false); // not a leap year
    expect(isValidRecordedDate('1899-12-31', now)).toBe(false);
  });
});
