import { describe, it, expect } from 'vitest';
import {
  isDue,
  reminderTitle,
  isValidReminderMinutes,
  REMINDER_OPTIONS,
} from '../reminders';

const NOW = Date.UTC(2026, 6, 28, 12, 0);
const min = (n: number) => n * 60_000;

describe('isDue', () => {
  it('due exactly at the lead boundary and inside the window', () => {
    expect(isDue(NOW + min(30), 30, NOW)).toBe(true);   // exactly 30 min out
    expect(isDue(NOW + min(15), 30, NOW)).toBe(true);   // inside window
  });

  it('not due before the window, at start, or in the past', () => {
    expect(isDue(NOW + min(31), 30, NOW)).toBe(false);  // just outside
    expect(isDue(NOW, 30, NOW)).toBe(false);            // already started
    expect(isDue(NOW - min(5), 30, NOW)).toBe(false);   // past
  });

  it('never due when reminders are off', () => {
    expect(isDue(NOW + min(5), 0, NOW)).toBe(false);
  });
});

describe('reminderTitle', () => {
  it('humanizes minutes, hours, days', () => {
    expect(reminderTitle('Practice', NOW + min(30), NOW)).toBe('Reminder: Practice starts in 30 minutes');
    expect(reminderTitle('Practice', NOW + min(1), NOW)).toBe('Reminder: Practice starts in 1 minute');
    expect(reminderTitle('Practice', NOW + min(90), NOW)).toBe('Reminder: Practice starts in 2 hours');
    expect(reminderTitle('Practice', NOW + min(60), NOW)).toBe('Reminder: Practice starts in 1 hour');
    expect(reminderTitle('Practice', NOW + min(3 * 1440), NOW)).toBe('Reminder: Practice starts in 3 days');
  });

  it('clamps to at least 1 minute', () => {
    expect(reminderTitle('Practice', NOW + 10_000, NOW)).toBe('Reminder: Practice starts in 1 minute');
  });
});

describe('isValidReminderMinutes', () => {
  it('accepts exactly the presets', () => {
    for (const preset of REMINDER_OPTIONS) {
      expect(isValidReminderMinutes(preset)).toBe(true);
    }
    expect(isValidReminderMinutes(15)).toBe(false);
    expect(isValidReminderMinutes(-10)).toBe(false);
    expect(isValidReminderMinutes('30')).toBe(false);
    expect(isValidReminderMinutes(null)).toBe(false);
  });
});
