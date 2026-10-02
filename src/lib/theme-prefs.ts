/**
 * Theme preference contract (profiles.theme_prefs JSONB, migration 069) and
 * the pure resolution logic behind every theme decision in the app.
 *
 * Pure and defensive, like equipment-prefs.ts: `sanitizeThemePrefs` accepts
 * ANY value and returns only known keys with valid values — it never throws,
 * because one malformed pref must never break a render.
 *
 * THE DEFAULT IS THE SCHEDULE (Oct 1 2026, Tom): an account or a device with
 * no stored choice is dark from 6 PM to 9 AM and light in the day, so
 * everyone meets both themes. Light, Dark and Match system are explicit
 * choices that stay until the schedule is chosen again. Until that day
 * absent meant always light — and four places decided it separately (this
 * file, the head script, the sanitizer, the quick switch). `effectiveMode`
 * is the ONE reading of "what mode is this"; nothing else may default it.
 *
 * The same logic is duplicated in miniature inside the head script
 * (theme-script.ts) so first paint can resolve the theme before React loads.
 * theme-script.test.ts pins the two implementations to each other — if you
 * change resolution semantics here, that test tells you to update the script.
 */

export type ThemeMode = 'off' | 'on' | 'scheduled' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Minutes since local midnight, 0–1439. */
export interface ThemeSchedule {
  start: number;
  end: number;
}

export interface ThemePrefs {
  /** Absent = DEFAULT_MODE (the schedule). 'off' = always light, 'on' = always dark. */
  mode?: ThemeMode;
  /** Absent = DEFAULT_SCHEDULE. Kept in EVERY mode: pinning light or dark
   *  must not lose the hours, so choosing the schedule again restores them. */
  schedule?: ThemeSchedule;
}

/** What an account / a device with no stored choice gets. */
export const DEFAULT_MODE: ThemeMode = 'scheduled';

/** Dark from 6 PM to 9 AM (device-local time), light from 9 AM to 6 PM. */
export const DEFAULT_SCHEDULE: ThemeSchedule = { start: 18 * 60, end: 9 * 60 };

const MODES: ThemeMode[] = ['off', 'on', 'scheduled', 'system'];

/** The one reading of "what mode is this" — never `prefs.mode ?? …` inline. */
export function effectiveMode(prefs: ThemePrefs): ThemeMode {
  return prefs.mode ?? DEFAULT_MODE;
}

function sanitizeMinutes(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < 0 || raw > 1439) return null;
  return raw;
}

export function sanitizeThemePrefs(raw: unknown): ThemePrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const prefs: ThemePrefs = {};

  if (MODES.includes(source.mode as ThemeMode)) {
    prefs.mode = source.mode as ThemeMode;
  }

  const scheduleRaw = source.schedule;
  if (typeof scheduleRaw === 'object' && scheduleRaw !== null && !Array.isArray(scheduleRaw)) {
    const start = sanitizeMinutes((scheduleRaw as Record<string, unknown>).start);
    const end = sanitizeMinutes((scheduleRaw as Record<string, unknown>).end);
    // start === end is a zero-length window — meaningless, drop it
    if (start !== null && end !== null && start !== end) {
      prefs.schedule = { start, end };
    }
  }

  // `override` (a manual switch that lasted until the next scheduled change)
  // was retired on Oct 1 2026: the quick switch now PINS the theme. A stored
  // one is simply not carried — it is an unknown key like any other.

  return prefs;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Cross-midnight aware: 18:00–09:00 is dark at 23:00 AND at 03:00. */
export function isInWindow(schedule: ThemeSchedule, minutes: number): boolean {
  const { start, end } = schedule;
  if (start === end) return false; // degenerate; sanitizer drops it, be safe
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

export function resolveTheme(
  prefs: ThemePrefs,
  now: Date,
  systemPrefersDark: boolean
): ResolvedTheme {
  switch (effectiveMode(prefs)) {
    case 'on':
      return 'dark';
    case 'off':
      return 'light';
    case 'system':
      return systemPrefersDark ? 'dark' : 'light';
    case 'scheduled':
    default:
      return isInWindow(prefs.schedule ?? DEFAULT_SCHEDULE, minutesOfDay(now)) ? 'dark' : 'light';
  }
}

/**
 * The quick switch (the top menu): the prefs after switching away from the
 * theme now showing. It PINS — the mode becomes 'on' or 'off' whatever it
 * was, the schedule and Match system included — and stays until the schedule
 * is chosen again in Settings → Appearance (Tom, Oct 1 2026). The hours ride
 * along untouched, so choosing the schedule again restores them.
 */
export function prefsAfterQuickSwitch(prefs: ThemePrefs, showing: ResolvedTheme): ThemePrefs {
  return { ...prefs, mode: showing === 'dark' ? 'off' : 'on' };
}

/** "8:00 PM" for helper copy under the Scheduled option. */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "20:00" ↔ minutes, for the native <input type="time"> pair. */
export function minutesToTimeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return sanitizeMinutes(minutes);
}
