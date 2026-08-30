import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatAge } from '../formatters';
import { AthleteService } from '../athleteService';

// dob is a DATE column. Parsing it with a bare `new Date()` lands on UTC
// midnight, which in any UTC- zone reads as the PREVIOUS day — while `today`
// (a real `new Date()`) does not shift. That asymmetry is the bug: the
// athlete's age ticks over ONE DAY EARLY.
//
// The failure window is narrow, which is exactly why it survived: a year-diff
// with a month/day adjustment absorbs a uniform shift, so the wrong answer
// only appears on the day BEFORE the birthday (and Dec 31 for a Jan 1 dob).
// Pinning "today" is therefore mandatory — without fake timers these tests
// pass against the broken code on 364 days out of 365.
//
// These ages are read by guardians on the family console. The legally
// meaningful gate is ageOn() in minors-config, which is UTC-correct on BOTH
// sides and is deliberately untouched.
describe('formatAge on a DATE column', () => {
  afterEach(() => vi.useRealTimers());

  /** Pin "now" to local noon so the assertion is about the date, not the clock. */
  const on = (day: string) => vi.setSystemTime(new Date(`${day}T12:00:00`));

  it('does not age the athlete up a day early', () => {
    // Born Aug 30 2006; on Aug 29 2026 they are still 19.
    on('2026-08-29');
    expect(formatAge('2006-08-30')).toBe('19');
    expect(AthleteService.formatAge('2006-08-30')).toBe('19');
  });

  it('ages them on the birthday itself', () => {
    on('2026-08-30');
    expect(formatAge('2006-08-30')).toBe('20');
    expect(AthleteService.formatAge('2006-08-30')).toBe('20');
  });

  it('a Jan 1 birthday does not turn over on New Year\'s Eve', () => {
    // The year-boundary case: the shifted parse lands in the previous YEAR.
    on('2026-12-31');
    expect(formatAge('2006-01-01')).toBe('20');
    expect(AthleteService.formatAge('2006-01-01')).toBe('20');
  });

  it('a Mar 1 birthday does not turn over on Feb 28', () => {
    on('2026-02-28');
    expect(formatAge('2006-03-01')).toBe('19');
    expect(AthleteService.formatAge('2006-03-01')).toBe('19');
  });

  it('is unchanged well away from the birthday', () => {
    on('2026-06-15');
    expect(formatAge('2006-01-01')).toBe('20');
  });

  it('still returns the em-dash for missing input', () => {
    expect(formatAge(null)).toBe('—');
    expect(formatAge(undefined)).toBe('—');
    expect(AthleteService.formatAge(undefined)).toBe('—');
  });
});
