import { describe, it, expect } from 'vitest';
import {
  getMinorThreshold,
  ageOn,
  isUnderThreshold,
  isSyntheticEmail,
  makeSyntheticEmail,
} from '../config/minors-config';

describe('getMinorThreshold', () => {
  it('returns jurisdiction-specific thresholds', () => {
    expect(getMinorThreshold('US')).toBe(13);
    expect(getMinorThreshold('CA-QC')).toBe(14);
    expect(getMinorThreshold('DE')).toBe(16);
    expect(getMinorThreshold('FR')).toBe(15);
  });

  it('is case-insensitive', () => {
    expect(getMinorThreshold('us')).toBe(13);
    expect(getMinorThreshold('ca-qc')).toBe(14);
  });

  it('falls back to the most restrictive default for unknown/missing', () => {
    expect(getMinorThreshold('BR')).toBe(16);
    expect(getMinorThreshold(null)).toBe(16);
    expect(getMinorThreshold(undefined)).toBe(16);
  });
});

describe('ageOn', () => {
  it('computes whole-year age before and after the birthday', () => {
    expect(ageOn('2012-06-15', '2025-06-14')).toBe(12);
    expect(ageOn('2012-06-15', '2025-06-15')).toBe(13);
    expect(ageOn('2012-06-15', '2025-06-16')).toBe(13);
  });

  it('handles year boundaries', () => {
    expect(ageOn('2012-12-31', '2025-01-01')).toBe(12);
  });
});

describe('isUnderThreshold', () => {
  it('12yo in the US is under; 13yo is not', () => {
    expect(isUnderThreshold('2013-01-10', 'US', '2025-06-01')).toBe(true);
    expect(isUnderThreshold('2012-01-10', 'US', '2025-06-01')).toBe(false);
  });

  it('15yo is fine in the US but under in Germany', () => {
    expect(isUnderThreshold('2010-01-10', 'US', '2025-06-01')).toBe(false);
    expect(isUnderThreshold('2010-01-10', 'DE', '2025-06-01')).toBe(true);
  });

  it('13yo in Quebec is under (Law 25: 14)', () => {
    expect(isUnderThreshold('2012-01-10', 'CA-QC', '2025-06-01')).toBe(true);
    expect(isUnderThreshold('2012-01-10', 'CA', '2025-06-01')).toBe(false);
  });
});

describe('synthetic emails', () => {
  it('round-trips and detects', () => {
    const email = makeSyntheticEmail('abc-123');
    expect(email).toBe('abc-123@minors.invalid');
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail('ABC-123@MINORS.INVALID')).toBe(true);
  });

  it('rejects real emails and empties', () => {
    expect(isSyntheticEmail('tom@gmail.com')).toBe(false);
    expect(isSyntheticEmail(null)).toBe(false);
    expect(isSyntheticEmail('')).toBe(false);
  });
});
