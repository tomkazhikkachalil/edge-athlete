/**
 * Theme preference contract (profiles.theme_prefs JSONB, migration 069) and
 * the pure resolution logic behind every theme decision in the app.
 *
 * Pure and defensive, like equipment-prefs.ts: `sanitizeThemePrefs` accepts
 * ANY value and returns only known keys with valid values — it never throws,
 * because one malformed pref must never break a render. NULL/absent prefs
 * mean light, i.e. pre-069 behavior.
 *
 * The same logic is duplicated in miniature inside THEME_INIT_SCRIPT
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

/**
 * A manual toggle made while in scheduled mode. Never expired in place:
 * whether it still applies is COMPUTED (isOverrideActive) — it lapses the
 * moment any schedule boundary passes after setAt, which is exactly
 * "honoured until the next scheduled transition" on every device at once.
 */
export interface ThemeOverride {
  theme: ResolvedTheme;
  setAt: string; // ISO timestamp
}

export interface ThemePrefs {
  /** Absent = 'off' = always light (pre-069 behavior). */
  mode?: ThemeMode;
  /** Absent = DEFAULT_SCHEDULE. Only meaningful when mode === 'scheduled'. */
  schedule?: ThemeSchedule;
  /** Only meaningful (and only kept by the sanitizer) in scheduled mode. */
  override?: ThemeOverride;
}

export const DEFAULT_SCHEDULE: ThemeSchedule = { start: 20 * 60, end: 7 * 60 };

const MODES: ThemeMode[] = ['off', 'on', 'scheduled', 'system'];

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

  // An override outside scheduled mode is dead state — don't carry it
  if (prefs.mode === 'scheduled') {
    const overrideRaw = source.override;
    if (typeof overrideRaw === 'object' && overrideRaw !== null && !Array.isArray(overrideRaw)) {
      const theme = (overrideRaw as Record<string, unknown>).theme;
      const setAt = (overrideRaw as Record<string, unknown>).setAt;
      if (
        (theme === 'light' || theme === 'dark') &&
        typeof setAt === 'string' &&
        !Number.isNaN(new Date(setAt).getTime())
      ) {
        prefs.override = { theme, setAt };
      }
    }
  }

  return prefs;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Cross-midnight aware: 20:00–07:00 is dark at 23:00 AND at 03:00. */
export function isInWindow(schedule: ThemeSchedule, minutes: number): boolean {
  const { start, end } = schedule;
  if (start === end) return false; // degenerate; sanitizer drops it, be safe
  return start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

/** The schedule's boundary at `minutes` on (day of ref + dayOffset), in local
 *  time via setDate/setHours so DST day-length changes are respected. */
function occurrenceOnDay(ref: Date, dayOffset: number, minutes: number): Date {
  const d = new Date(ref);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Most recent schedule boundary (a daily occurrence of start or end) ≤ now. */
export function prevTransition(schedule: ThemeSchedule, now: Date): Date {
  let best: Date | null = null;
  for (const minutes of [schedule.start, schedule.end]) {
    for (const dayOffset of [0, -1]) {
      const t = occurrenceOnDay(now, dayOffset, minutes);
      if (t.getTime() <= now.getTime() && (best === null || t.getTime() > best.getTime())) {
        best = t;
      }
    }
  }
  // Both boundaries occur once per day, so one of the four candidates
  // always lands in the last 24h.
  return best as Date;
}

/** First schedule boundary strictly after now. */
export function nextTransition(schedule: ThemeSchedule, now: Date): Date {
  let best: Date | null = null;
  for (const minutes of [schedule.start, schedule.end]) {
    for (const dayOffset of [0, 1]) {
      const t = occurrenceOnDay(now, dayOffset, minutes);
      if (t.getTime() > now.getTime() && (best === null || t.getTime() < best.getTime())) {
        best = t;
      }
    }
  }
  return best as Date;
}

/** Active iff no schedule boundary has passed since the override was set. */
export function isOverrideActive(
  override: ThemeOverride,
  schedule: ThemeSchedule,
  now: Date
): boolean {
  const setAt = new Date(override.setAt).getTime();
  if (Number.isNaN(setAt)) return false;
  return setAt > prevTransition(schedule, now).getTime();
}

export function resolveTheme(
  prefs: ThemePrefs,
  now: Date,
  systemPrefersDark: boolean
): ResolvedTheme {
  switch (prefs.mode ?? 'off') {
    case 'on':
      return 'dark';
    case 'system':
      return systemPrefersDark ? 'dark' : 'light';
    case 'scheduled': {
      const schedule = prefs.schedule ?? DEFAULT_SCHEDULE;
      if (prefs.override && isOverrideActive(prefs.override, schedule, now)) {
        return prefs.override.theme;
      }
      return isInWindow(schedule, minutesOfDay(now)) ? 'dark' : 'light';
    }
    case 'off':
    default:
      return 'light';
  }
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
