import { describe, it, expect } from 'vitest';
import { formatDuration } from '../duration';

describe('formatDuration', () => {
  it('formats under a minute with a leading zero minute', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(59)).toBe('0:59');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('formats hours with zero-padded minutes', () => {
    expect(formatDuration(3671)).toBe('1:01:11');
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  it('rounds fractional seconds', () => {
    expect(formatDuration(9.6)).toBe('0:10');
  });

  it('never renders NaN for a non-finite duration', () => {
    // MediaRecorder files report Infinity until force-seeked — a real case
    // this repo has already hit once (see ensureSeekableDuration).
    expect(formatDuration(Infinity)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });

  it('clamps negatives rather than emitting a minus sign', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});
