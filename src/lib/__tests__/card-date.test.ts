import { describe, it, expect } from 'vitest';
import { formatCardDate } from '@/components/StatHighlightCard';

// The feed card and the round detail modal disagreed about the same round's
// date: the card said "Aug 29" while the modal said "August 30, 2026",
// because the card fed a DATE-column value straight to `new Date()` — UTC
// midnight, so every US timezone renders the PREVIOUS day. The modal already
// used parseDateLocal; this card was missed when that sweep went through.
//
// (parseDateLocal itself is covered in parse-date-local.test.ts. This pins the
// CALLER, which is where the bug actually lived.)
describe('formatCardDate', () => {
  it('renders the calendar day that was stored, not the UTC-shifted one', () => {
    // "Aug 29" under the old parse in any UTC- zone; the round is Aug 30.
    expect(formatCardDate('2026-08-30')).toBe('Aug 30');
  });

  it('agrees with the stored day across a month boundary', () => {
    // The nastiest case: the shift moves the MONTH too.
    expect(formatCardDate('2026-09-01')).toBe('Sep 1');
    expect(formatCardDate('2026-01-01')).toBe('Jan 1');
  });

  it('still formats a full timestamp', () => {
    expect(formatCardDate('2026-08-22T15:30:00.000Z')).toBe(
      new Date('2026-08-22T15:30:00.000Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    );
  });

  it('passes garbage through untouched rather than rendering "Invalid Date"', () => {
    expect(formatCardDate('nonsense')).toBe('nonsense');
  });
});
