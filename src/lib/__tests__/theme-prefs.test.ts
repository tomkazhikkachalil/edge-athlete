import { describe, it, expect } from 'vitest';
import {
  sanitizeThemePrefs,
  isInWindow,
  minutesOfDay,
  prevTransition,
  nextTransition,
  isOverrideActive,
  resolveTheme,
  formatMinutes,
  minutesToTimeValue,
  timeValueToMinutes,
  DEFAULT_SCHEDULE,
} from '../theme-prefs';

// All dates built with the local-time constructor — the schedule is defined
// in device-local minutes, so tests must be TZ-independent by construction.
const aug5 = (h: number, m = 0) => new Date(2026, 7, 5, h, m);
const aug6 = (h: number, m = 0) => new Date(2026, 7, 6, h, m);
const aug8 = (h: number, m = 0) => new Date(2026, 7, 8, h, m);

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
        override: { theme: 'light', setAt: '2026-08-05T21:00:00.000Z' },
        evil: 'ignored',
      })
    ).toEqual({
      mode: 'scheduled',
      schedule: { start: 1200, end: 420 },
      override: { theme: 'light', setAt: '2026-08-05T21:00:00.000Z' },
    });
  });

  it('drops invalid modes, minutes out of range, and zero-length windows', () => {
    expect(sanitizeThemePrefs({ mode: 'chaos' })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: -1, end: 420 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 1200, end: 1440 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 600.5, end: 420 } })).toEqual({});
    expect(sanitizeThemePrefs({ schedule: { start: 420, end: 420 } })).toEqual({});
  });

  it('drops overrides outside scheduled mode and with bad payloads', () => {
    expect(
      sanitizeThemePrefs({ mode: 'on', override: { theme: 'light', setAt: '2026-08-05T21:00:00Z' } })
    ).toEqual({ mode: 'on' });
    expect(
      sanitizeThemePrefs({ mode: 'scheduled', override: { theme: 'dim', setAt: '2026-08-05T21:00:00Z' } })
    ).toEqual({ mode: 'scheduled' });
    expect(
      sanitizeThemePrefs({ mode: 'scheduled', override: { theme: 'dark', setAt: 'not-a-date' } })
    ).toEqual({ mode: 'scheduled' });
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

describe('prevTransition / nextTransition', () => {
  const overnight = { start: 1200, end: 420 };

  it('finds the boundaries around a mid-window evening moment', () => {
    expect(prevTransition(overnight, aug5(23)).getTime()).toBe(aug5(20).getTime());
    expect(nextTransition(overnight, aug5(23)).getTime()).toBe(aug6(7).getTime());
  });

  it('finds the boundaries around a post-midnight moment', () => {
    expect(prevTransition(overnight, aug6(3)).getTime()).toBe(aug5(20).getTime());
    expect(nextTransition(overnight, aug6(3)).getTime()).toBe(aug6(7).getTime());
  });

  it('treats a boundary moment as already passed', () => {
    expect(prevTransition(overnight, aug6(7)).getTime()).toBe(aug6(7).getTime());
    expect(nextTransition(overnight, aug6(7)).getTime()).toBe(aug6(20).getTime());
  });
});

describe('isOverrideActive', () => {
  const overnight = { start: 1200, end: 420 };
  const setAt2100 = { theme: 'light' as const, setAt: aug5(21).toISOString() };

  it('honours an in-window override until the next transition', () => {
    expect(isOverrideActive(setAt2100, overnight, aug5(23, 59))).toBe(true);
    expect(isOverrideActive(setAt2100, overnight, aug6(6, 59))).toBe(true);
  });

  it('expires the moment a boundary passes — including after multi-day gaps', () => {
    expect(isOverrideActive(setAt2100, overnight, aug6(7))).toBe(false);
    expect(isOverrideActive(setAt2100, overnight, aug8(12))).toBe(false);
  });

  it('an override set OUTSIDE the window expires at the window start', () => {
    const daytimeToggle = { theme: 'dark' as const, setAt: aug5(14).toISOString() };
    expect(isOverrideActive(daytimeToggle, overnight, aug5(19, 59))).toBe(true);
    expect(isOverrideActive(daytimeToggle, overnight, aug5(20))).toBe(false);
  });

  it('rejects unparseable timestamps', () => {
    expect(isOverrideActive({ theme: 'dark', setAt: 'garbage' }, overnight, aug5(23))).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('off (and absent mode) is always light; on is always dark', () => {
    expect(resolveTheme({}, aug5(23), true)).toBe('light');
    expect(resolveTheme({ mode: 'off' }, aug5(23), true)).toBe('light');
    expect(resolveTheme({ mode: 'on' }, aug5(12), false)).toBe('dark');
  });

  it('system follows the OS preference', () => {
    expect(resolveTheme({ mode: 'system' }, aug5(12), true)).toBe('dark');
    expect(resolveTheme({ mode: 'system' }, aug5(23), false)).toBe('light');
  });

  it('scheduled uses the default 20:00–07:00 window when unset', () => {
    expect(resolveTheme({ mode: 'scheduled' }, aug5(23), false)).toBe('dark');
    expect(resolveTheme({ mode: 'scheduled' }, aug6(3), false)).toBe('dark');
    expect(resolveTheme({ mode: 'scheduled' }, aug5(12), false)).toBe('light');
  });

  it('scheduled honours a custom window', () => {
    const prefs = { mode: 'scheduled' as const, schedule: { start: 540, end: 1020 } };
    expect(resolveTheme(prefs, aug5(10), false)).toBe('dark');
    expect(resolveTheme(prefs, aug5(18), false)).toBe('light');
  });

  it('an active override wins; an expired one falls back to the schedule', () => {
    const prefs = {
      mode: 'scheduled' as const,
      override: { theme: 'light' as const, setAt: aug5(21).toISOString() },
    };
    expect(resolveTheme(prefs, aug5(23), false)).toBe('light'); // overridden
    expect(resolveTheme(prefs, aug6(8), false)).toBe('light'); // expired, out of window
    expect(resolveTheme(prefs, aug6(21), false)).toBe('dark'); // expired, next evening resumes
  });
});

describe('time formatting helpers', () => {
  it('round-trips minutes through the <input type="time"> value format', () => {
    expect(minutesToTimeValue(DEFAULT_SCHEDULE.start)).toBe('20:00');
    expect(minutesToTimeValue(DEFAULT_SCHEDULE.end)).toBe('07:00');
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
