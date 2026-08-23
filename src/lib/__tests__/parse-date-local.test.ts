import { describe, it, expect } from 'vitest';
import { parseDateLocal, formatDate } from '../formatters';

// The bug this guards: a DATE-column value ("2026-08-22") fed to new Date()
// parses as UTC midnight, so every US timezone rendered the PREVIOUS day on
// round cards while the calendar overlay (parsing parts locally) showed the
// right one.
describe('parseDateLocal', () => {
  it('reads a date-only string as a LOCAL calendar date', () => {
    const d = parseDateLocal('2026-08-22');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(22); // local, regardless of TZ — the whole point
  });

  it('leaves full timestamps to native parsing', () => {
    const d = parseDateLocal('2026-08-22T15:30:00.000Z');
    expect(d.getTime()).toBe(new Date('2026-08-22T15:30:00.000Z').getTime());
  });

  it('passes garbage through as an Invalid Date rather than throwing', () => {
    expect(isNaN(parseDateLocal('not-a-date').getTime())).toBe(true);
  });
});

describe('formatDate with date-only input', () => {
  it('renders the calendar day that was stored', () => {
    // Would be "Aug 21, 2026" under the old new Date() parse in any UTC- zone.
    expect(formatDate('2026-08-22')).toBe('Aug 22, 2026');
  });

  it('still handles null/invalid', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nonsense')).toBe('—');
  });
});
