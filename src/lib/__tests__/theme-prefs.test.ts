import { describe, it, expect } from 'vitest';
import {
  sanitizeThemePrefs,
  isInWindow,
  minutesOfDay,
  resolveTheme,
  effectiveMode,
  prefsAfterQuickSwitch,
  formatMinutes,
  minutesToTimeValue,
  timeValueToMinutes,
  DEFAULT_MODE,
  DEFAULT_SCHEDULE,
} from '../theme-prefs';

// All dates built with the local-time constructor — the schedule is defined
// in device-local minutes, so tests must be TZ-independent by construction.
const aug5 = (h: number, m = 0) => new Date(2026, 7, 5, h, m);
const aug6 = (h: number, m = 0) => new Date(2026, 7, 6, h, m);

describe('sanitizeThemePrefs', () => {
  it('returns {} for anything non-object (never throws)', () => {
    for (const raw of [null, undefined, 'x', 42, [], true]) {
      expect(sanitizeThemePrefs(raw)).toEqual({});
    }
  });

  it('keeps only known keys with valid values', () => {
    expect(
      sanitizeThemePrefs({
        mode: 'scheduled',
        schedule: { start: 1200, end: 420 },
        evil: 'ignored',
      })
    ).toEqual({
      mode: 'scheduled',
      schedule: { start: 1200, end: 420 },
    });
  });

  it('a stored override (retired Oct 1 2026: the quick switch pins now) is not carried', () => {
    expect(
      sanitizeThemePrefs({
        mode: 'scheduled',
        schedule: { start: 1200, end: 420 },
        override: { theme: 'light', setAt: '2026-08-05T21:00:00.000Z' },
      })
    ).toEqual({ mode: 'scheduled', schedule: { start: 1200, end: 420 } });
  });

  it('keeps the hours in EVERY mode, so the schedule comes back as it was', () => {
    for (const mode of ['off', 'on', 'system'] as const) {
      expect(sanitizeThemePrefs({ mode, schedule: { start: 1290, end: 400 } })).toEqual({
        mode,
        schedule: { start: 1290, end: 400 },
      });
    }
  });

  it('drops invalid modes, minutes out of range, and zero-length windows', () => {
    expect(sanitizeThemePrefs({ mode: 'chaos' })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: -1, end: 420 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 1200, end: 1440 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 600.5, end: 420 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 420, end: 420 } })).toEqual({});
  });

});

describe('isInWindow', () => {
  const overnight = { start: 1200, end: 420 }; // 20:00–07:00

  it('handles windows that cross midnight', () => {
    expect(isInWindow(overnight, minutesOfDay(aug5(23)))).toBe(true);
    expect(isInWindow(overnight, minutesOfDay(aug6(3)))).toBe(true);
    expect(isInWindow(overnight, minutesOfDay(aug5(12)))).toBe(false);
  });

  it('is inclusive at start, exclusive at end', () => {
    expect(isInWindow(overnight, 1200)).toBe(true); // 20:00 exactly → dark
    expect(isInWindow(overnight, 420)).toBe(false); // 07:00 exactly → light
    expect(isInWindow(overnight, 419)).toBe(true);
  });

  it('handles same-day windows too', () => {
    const daytime = { start: 540, end: 1020 }; // 09:00–17:00
    expect(isInWindow(daytime, 600)).toBe(true);
    expect(isInWindow(daytime, 530)).toBe(false);
    expect(isInWindow(daytime, 1020)).toBe(false);
  });
});

describe('the default (Oct 1 2026): the schedule, dark 6 PM – 9 AM', () => {
  it('an absent mode IS the schedule; an explicit mode is itself', () => {
    expect(DEFAULT_MODE).toBe('scheduled');
    expect(effectiveMode({})).toBe('scheduled');
    expect(effectiveMode({ schedule: { start: 600, end: 700 } })).toBe('scheduled');
    for (const mode of ['off', 'on', 'scheduled', 'system'] as const) {
      expect(effectiveMode({ mode })).toBe(mode);
    }
  });

  it('the default hours', () => {
    expect(DEFAULT_SCHEDULE).toEqual({ start: 18 * 60, end: 9 * 60 });
  });

  it('nothing stored: dark from 6 PM, through midnight, to 9 AM; light in the day', () => {
    expect(resolveTheme({}, aug5(17, 59), false)).toBe('light');
    expect(resolveTheme({}, aug5(18), false)).toBe('dark'); // 6:00 PM exactly
    expect(resolveTheme({}, aug5(23), false)).toBe('dark');
    expect(resolveTheme({}, aug6(3), false)).toBe('dark');
    expect(resolveTheme({}, aug6(8, 59), false)).toBe('dark');
    expect(resolveTheme({}, aug6(9), false)).toBe('light'); // 9:00 AM exactly
    expect(resolveTheme({}, aug6(12), false)).toBe('light');
  });

  it('nothing stored ignores the OS setting — that is Match system, an explicit choice', () => {
    expect(resolveTheme({}, aug5(12), true)).toBe('light');
    expect(resolveTheme({}, aug5(23), false)).toBe('dark');
  });

  it('anything unreadable sanitizes to nothing stored, i.e. the schedule', () => {
    for (const raw of [null, 'x', [], { mode: 'chaos' }]) {
      expect(resolveTheme(sanitizeThemePrefs(raw), aug5(23), false)).toBe('dark');
      expect(resolveTheme(sanitizeThemePrefs(raw), aug5(12), true)).toBe('light');
    }
  });
});

describe('resolveTheme', () => {
  it('off is always light and on is always dark — a pin, whatever the hour or the hours', () => {
    expect(resolveTheme({ mode: 'off' }, aug5(23), true)).toBe('light');
    expect(resolveTheme({ mode: 'on' }, aug5(12), false)).toBe('dark');
    // The stored hours ride along with a pin and are not consulted.
    expect(resolveTheme({ mode: 'off', schedule: { start: 0, end: 1439 } }, aug5(12), true)).toBe('light');
    expect(resolveTheme({ mode: 'on', schedule: { start: 600, end: 601 } }, aug5(12), false)).toBe('dark');
  });

  it('system follows the OS preference', () => {
    expect(resolveTheme({ mode: 'system' }, aug5(12), true)).toBe('dark');
    expect(resolveTheme({ mode: 'system' }, aug5(23), false)).toBe('light');
  });

  it('scheduled uses the default 18:00–09:00 window when unset', () => {
    expect(resolveTheme({ mode: 'scheduled' }, aug5(23), false)).toBe('dark');
    expect(resolveTheme({ mode: 'scheduled' }, aug6(3), false)).toBe('dark');
    expect(resolveTheme({ mode: 'scheduled' }, aug5(12), false)).toBe('light');
    expect(resolveTheme({ mode: 'scheduled' }, aug5(17), false)).toBe('light');
  });

  it('scheduled honours a custom window', () => {
    const prefs = { mode: 'scheduled' as const, schedule: { start: 540, end: 1020 } };
    expect(resolveTheme(prefs, aug5(10), false)).toBe('dark');
    expect(resolveTheme(prefs, aug5(18), false)).toBe('light');
  });

});

describe('prefsAfterQuickSwitch — the top-menu switch pins', () => {
  it('switches away from what is showing, in every mode, and turns the schedule off', () => {
    expect(prefsAfterQuickSwitch({}, 'dark')).toEqual({ mode: 'off' });
    expect(prefsAfterQuickSwitch({}, 'light')).toEqual({ mode: 'on' });
    expect(prefsAfterQuickSwitch({ mode: 'scheduled' }, 'dark')).toEqual({ mode: 'off' });
    expect(prefsAfterQuickSwitch({ mode: 'system' }, 'light')).toEqual({ mode: 'on' });
    expect(prefsAfterQuickSwitch({ mode: 'on' }, 'dark')).toEqual({ mode: 'off' });
    expect(prefsAfterQuickSwitch({ mode: 'off' }, 'light')).toEqual({ mode: 'on' });
  });

  it('the pin holds across the next scheduled change (it used to lapse there)', () => {
    const pinned = prefsAfterQuickSwitch({}, resolveTheme({}, aug5(23), false)); // dark → pin light
    expect(pinned).toEqual({ mode: 'off' });
    expect(resolveTheme(pinned, aug6(10), false)).toBe('light');
    expect(resolveTheme(pinned, aug6(23), false)).toBe('light'); // the next evening: still light
  });

  it('keeps the hours, so choosing the schedule again restores them', () => {
    const hours = { start: 1290, end: 400 };
    const pinned = prefsAfterQuickSwitch({ mode: 'scheduled', schedule: hours }, 'light');
    expect(pinned).toEqual({ mode: 'on', schedule: hours });
    expect(sanitizeThemePrefs({ ...pinned, mode: 'scheduled' })).toEqual({ mode: 'scheduled', schedule: hours });
  });
});

describe('time formatting helpers', () => {
  it('round-trips minutes through the <input type="time"> value format', () => {
    expect(minutesToTimeValue(DEFAULT_SCHEDULE.start)).toBe('18:00');
    expect(minutesToTimeValue(DEFAULT_SCHEDULE.end)).toBe('09:00');
    expect(timeValueToMinutes('20:00')).toBe(1200);
    expect(timeValueToMinutes('07:05')).toBe(425);
    expect(timeValueToMinutes('7:05')).toBeNull();
    expect(timeValueToMinutes('24:00')).toBeNull();
  });

  it('formats minutes as 12-hour copy', () => {
    expect(formatMinutes(1200)).toBe('8:00 PM');
    expect(formatMinutes(420)).toBe('7:00 AM');
    expect(formatMinutes(0)).toBe('12:00 AM');
    expect(formatMinutes(725)).toBe('12:05 PM');
  });
});
