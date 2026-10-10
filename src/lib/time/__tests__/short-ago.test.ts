import { describe, it, expect } from 'vitest';
import { shortAgo } from '../short-ago';

const now = new Date(2026, 9, 9, 18, 0, 0);
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

describe('shortAgo', () => {
  it('reads seconds as Just now, then minutes, hours and days', () => {
    expect(shortAgo(ago(5), now)).toBe('Just now');
    expect(shortAgo(ago(59), now)).toBe('Just now');
    expect(shortAgo(ago(60), now)).toBe('1m');
    expect(shortAgo(ago(59 * 60), now)).toBe('59m');
    expect(shortAgo(ago(3 * 3600), now)).toBe('3h');
    expect(shortAgo(ago(2 * 86400), now)).toBe('2d');
    expect(shortAgo(ago(6 * 86400 + 3600), now)).toBe('6d');
  });

  it('a week or more is the date, with the year only when it differs', () => {
    expect(shortAgo(new Date(2026, 8, 30, 9, 0), now)).toBe('Sep 30');
    expect(shortAgo(new Date(2025, 11, 31, 9, 0), now)).toBe('Dec 31, 2025');
  });

  it('a clock slightly ahead never shows a negative time; garbage shows nothing', () => {
    expect(shortAgo(new Date(now.getTime() + 30_000), now)).toBe('Just now');
    expect(shortAgo('not a date', now)).toBe('');
  });
});
