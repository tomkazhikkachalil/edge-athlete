// ── What counts as a training session in Training, and the week maths (pure) ──
//
// Until Oct 1 2026 Training counted ONE thing: a completed workout session
// (the gym log). A run, ride or swim recorded on a watch lived on its own
// profile tab and moved no weekly bar, no streak, no active day — Tom: the
// watch integration "was supposed to be a part of the Training app".
//
// A TrainingSession is either. Everything below takes the merged list, so the
// hero, the weekly bars, the streak and the active-days ring count both
// kinds. The workout-only helpers (workouts/dashboard.ts weeklySummary /
// streakWeeks, training/derive.ts activeDaysThisWeek / weeklyBars) are now
// thin wrappers over these — one bucket rule, not two.
//
// Weeks and days are the VIEWER's local ones, read off `startedAt` — the
// rule the workout maths always had.

import { startOfWeek } from '@/lib/workouts/week';

export interface TrainingSession {
  id: string;
  kind: 'workout' | 'activity';
  /** ISO instant the session started. */
  startedAt: string;
  /** Workout: stored duration; activity: moving time where known, else elapsed. */
  seconds: number;
  /** Lifted volume in lbs — a workout's; 0 for an activity. */
  volumeLbs: number;
  title: string;
  /** An activity's type (run, ride, …) and distance; absent on a workout. */
  activityType?: string;
  distanceM?: number | null; sourceName?: string | null;
  /** A9: a sport session's sport (a SportRegistry key) and kind (practice | game | other). */
  sportKey?: string | null;
  sessionKind?: string | null;
  /** 265 (A11): how hard it felt, 1–10 — absent or null when not rated. */
  effort?: number | null;
}

export interface WeekTotals {
  /** Sessions of either kind (the field kept its pre-merge name). */
  workouts: number;
  volumeLbs: number;
  seconds: number;
  /** A11: Σ minutes × effort over the RATED sessions (session-RPE). */
  load: number;
  /** How many of `workouts` carry an effort — the load's honesty line. */
  rated: number;
}

export interface WeeklySummary extends WeekTotals {
  /** The immediately preceding week, for delta arrows. */
  prior: WeekTotals;
}

export interface WeekBar {
  /** Local Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  workouts: number;
  volumeLbs: number;
  seconds: number;
  load: number;
  rated: number;
  isCurrent: boolean;
}

/**
 * A session's training load (A11, Oct 16 2026): minutes × effort — the
 * session-RPE measure (Foster), the one intensity a timer-only session has.
 * A session nobody rated contributes NOTHING: a load is never imputed (Tom's
 * review — "6 of 8 rated" says what the number covers).
 */
export function loadOf(s: Pick<TrainingSession, 'seconds' | 'effort'>): number {
  const e = s.effort;
  if (typeof e !== 'number' || !(e >= 1 && e <= 10) || !(s.seconds > 0)) return 0;
  return (s.seconds / 60) * e;
}

const isRated = (s: Pick<TrainingSession, 'effort'>): boolean => typeof s.effort === 'number' && s.effort >= 1 && s.effort <= 10;

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** This week vs last week. */
export function sessionsWeeklySummary(sessions: readonly TrainingSession[], now: Date = new Date()): WeeklySummary {
  const thisWeekStart = startOfWeek(now).getTime();
  const priorWeekStart = thisWeekStart - WEEK_MS;
  const totals: WeekTotals = { workouts: 0, volumeLbs: 0, seconds: 0, load: 0, rated: 0 };
  const prior: WeekTotals = { workouts: 0, volumeLbs: 0, seconds: 0, load: 0, rated: 0 };
  for (const s of sessions) {
    const t = new Date(s.startedAt).getTime();
    const bucket = t >= thisWeekStart ? totals : t >= priorWeekStart ? prior : null;
    if (!bucket) continue;
    bucket.workouts += 1;
    bucket.volumeLbs += s.volumeLbs;
    bucket.seconds += s.seconds;
    bucket.load += loadOf(s);
    if (isRated(s)) bucket.rated += 1;
  }
  totals.volumeLbs = Math.round(totals.volumeLbs);
  prior.volumeLbs = Math.round(prior.volumeLbs);
  totals.load = Math.round(totals.load);
  prior.load = Math.round(prior.load);
  return { ...totals, prior };
}

/**
 * Consecutive weeks with at least one session, counting back from the
 * current week. An empty CURRENT week doesn't break the streak (on Monday
 * morning every streak would read zero otherwise); an empty PRIOR week does.
 */
export function sessionsStreakWeeks(sessions: readonly TrainingSession[], now: Date = new Date()): number {
  const weeks = new Set<number>();
  for (const s of sessions) weeks.add(startOfWeek(new Date(s.startedAt)).getTime());
  let cursor = startOfWeek(now).getTime();
  let streak = 0;
  if (!weeks.has(cursor)) cursor -= WEEK_MS;
  while (weeks.has(cursor)) {
    streak += 1;
    cursor -= WEEK_MS;
  }
  return streak;
}

/** Distinct local days with a session in the current Monday-anchored week (n of 7). */
export function sessionsActiveDays(sessions: readonly TrainingSession[], now: Date = new Date()): number {
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = weekStart + WEEK_MS;
  const days = new Set<string>();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    const t = d.getTime();
    if (t < weekStart || t >= weekEnd) continue;
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return Math.min(7, days.size);
}

/**
 * The last `weeks` Monday-anchored weeks (oldest first, current week last).
 * Empty weeks render honestly as zeros. Week boundaries step by calendar
 * date, not fixed milliseconds, so DST shifts can't smear a bucket.
 */
export function sessionsWeeklyBars(sessions: readonly TrainingSession[], weeks: number, now: Date = new Date()): WeekBar[] {
  const starts: Date[] = [];
  let cursor = startOfWeek(now);
  for (let i = 0; i < weeks; i++) {
    starts.unshift(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }
  const barByStart = new Map<number, WeekBar>();
  const bars = starts.map((start, i) => {
    const bar: WeekBar = { weekStart: localDateKey(start), workouts: 0, volumeLbs: 0, seconds: 0, load: 0, rated: 0, isCurrent: i === starts.length - 1 };
    barByStart.set(start.getTime(), bar);
    return bar;
  });
  for (const s of sessions) {
    const bar = barByStart.get(startOfWeek(new Date(s.startedAt)).getTime());
    if (!bar) continue;
    bar.workouts += 1;
    bar.volumeLbs += s.volumeLbs;
    bar.seconds += s.seconds;
    bar.load += loadOf(s);
    if (isRated(s)) bar.rated += 1;
  }
  for (const bar of bars) {
    bar.volumeLbs = Math.round(bar.volumeLbs);
    bar.load = Math.round(bar.load);
  }
  return bars;
}
