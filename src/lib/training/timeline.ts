// ── Training's timeline: Year → Month → Week → Session (pure) ────────────────
// "One wave", phase 2 (Nov 2026; Tom: Training stays its own tab, deepened
// Year → Month → Week → Session). The server sends every session the viewer
// may see as one narrow row; the grouping happens HERE, in the viewer's own
// calendar — the rule the week maths always had (a session at 11 pm on the
// 31st is that month's; a week starts Monday 00:00 local, workouts/week.ts).
//
// A week that crosses a month end shows, inside each month, only that month's
// days ("Nov 30" and "Dec 1 – 6"): the weeks of a month add up to the month,
// the months to the year. Opening either half opens the whole week.

import { startOfWeek } from '@/lib/workouts/week';

export interface TimelineSession {
  id: string;
  kind: 'workout' | 'activity';
  /** ISO instant the session started. */
  startedAt: string;
  /** Workout: stored duration; activity: moving time where known, else elapsed. */
  seconds: number;
  /** An activity's distance; null on a workout. */
  distanceM: number | null;
  title: string;
  /** An activity's type (run, ride, …). */
  type?: string;
  /** How hard it felt, 1–10, when rated. */
  effort?: number | null;
}

export interface TimelineTotals {
  sessions: number;
  seconds: number;
  /** Distinct local days with at least one session. */
  activeDays: number;
  distanceM: number;
  /** Σ minutes × effort over the RATED sessions (session-RPE) — and how many were rated. */
  load: number;
  rated: number;
}

export interface TimelineYear extends TimelineTotals { year: number }
export interface TimelineMonth extends TimelineTotals { /** "2026-11" */ key: string; year: number; /** 1–12 */ month: number }
export interface TimelineWeekPart extends TimelineTotals {
  /** The week's Monday, local, YYYY-MM-DD — the week's address. */
  week: string;
  /** The first and last local day shown (the whole week, or the part inside a month). */
  from: string;
  to: string;
}
export interface TimelineDay { /** Local YYYY-MM-DD */ key: string; sessions: TimelineSession[] }

/** Where History stands: everything, a year, a month, or a week. */
export type HistoryScope =
  | { level: 'all' }
  | { level: 'year'; year: number }
  | { level: 'month'; year: number; month: number }
  | { level: 'week'; week: string }
  /** One workout's own page (PR 2). An activity's page is its own route, /activities/[id]. */
  | { level: 'session'; id: string };

const pad = (n: number) => String(n).padStart(2, '0');
/** A local calendar day as YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** The local Monday of an instant's week, YYYY-MM-DD. */
export const weekKeyOf = (d: Date) => dayKey(startOfWeek(d));
/** A YYYY-MM-DD key as a local date (noon: no DST edge can move the day). */
export const dateOfKey = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12);

function fold<T extends TimelineTotals>(bucket: T, days: Set<string>, s: TimelineSession, day: string): void {
  bucket.sessions += 1;
  bucket.seconds += s.seconds;
  bucket.distanceM += s.distanceM ?? 0;
  if (typeof s.effort === 'number' && s.effort > 0 && s.seconds > 0) {
    bucket.load += (s.seconds / 60) * s.effort;
    bucket.rated += 1;
  }
  days.add(day);
  bucket.activeDays = days.size;
}
const zero = (): TimelineTotals => ({ sessions: 0, seconds: 0, activeDays: 0, distanceM: 0, load: 0, rated: 0 });
const settle = <T extends TimelineTotals>(b: T): T => ({ ...b, load: Math.round(b.load), distanceM: Math.round(b.distanceM) });

function group<T extends TimelineTotals>(sessions: readonly TimelineSession[], keyOf: (d: Date, day: string) => string | null, make: (key: string, d: Date, day: string) => T): T[] {
  const buckets = new Map<string, { row: T; days: Set<string> }>();
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (Number.isNaN(d.getTime())) continue;
    const day = dayKey(d);
    const key = keyOf(d, day);
    if (key === null) continue;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { row: make(key, d, day), days: new Set() }));
    fold(b.row, b.days, s, day);
  }
  return [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, b]) => settle(b.row));
}

/** Everything in the given sessions as one total. */
export function timelineTotals(sessions: readonly TimelineSession[]): TimelineTotals {
  return group(sessions, () => 'all', () => zero())[0] ?? zero();
}

/** The years that hold a session, newest first. */
export function timelineYears(sessions: readonly TimelineSession[]): TimelineYear[] {
  return group(sessions, d => String(d.getFullYear()), (_k, d) => ({ ...zero(), year: d.getFullYear() }));
}

/** A year's months that hold a session, newest first. */
export function timelineMonths(sessions: readonly TimelineSession[], year: number): TimelineMonth[] {
  return group(
    sessions,
    d => (d.getFullYear() === year ? `${year}-${pad(d.getMonth() + 1)}` : null),
    (key, d) => ({ ...zero(), key, year, month: d.getMonth() + 1 })
  );
}

/** A month's weeks, newest first — each counted over the days INSIDE the month, so they add up to it. */
export function timelineWeeks(sessions: readonly TimelineSession[], year: number, month: number): TimelineWeekPart[] {
  const first = new Date(year, month - 1, 1, 12);
  const last = new Date(year, month, 0, 12);
  return group(
    sessions,
    d => (d.getFullYear() === year && d.getMonth() + 1 === month ? weekKeyOf(d) : null),
    key => {
      const monday = dateOfKey(key);
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12);
      return { ...zero(), week: key, from: dayKey(monday < first ? first : monday), to: dayKey(sunday > last ? last : sunday) };
    }
  );
}

/** The sessions of one week (its Monday's key), every one of its seven days. */
export function weekSessions(sessions: readonly TimelineSession[], week: string): TimelineSession[] {
  return sessions.filter(s => {
    const d = new Date(s.startedAt);
    return !Number.isNaN(d.getTime()) && weekKeyOf(d) === week;
  });
}

/** A week's sessions day by day: newest day first, and inside a day the order they happened. */
export function timelineDays(sessions: readonly TimelineSession[]): TimelineDay[] {
  const days = new Map<string, TimelineSession[]>();
  for (const s of sessions) {
    const key = dayKey(new Date(s.startedAt));
    const list = days.get(key);
    if (list) list.push(s);
    else days.set(key, [s]);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({ key, sessions: [...list].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)) }));
}

/** The whole week a Monday key names: its first and last day. */
export function weekRange(week: string): { from: string; to: string } {
  const monday = dateOfKey(week);
  return { from: week, to: dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12)) };
}

// ── The address ─────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20)\d{2}$/;
const MONTH = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/;
const DAY = /^((?:19|20)\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * `?year=`, `?month=`, `?week=`, `?session=` arrive from the URL: the deepest one that reads
 * wins; anything else is the whole History. A `week` that is not a Monday is
 * that day's week (a hand-typed date still lands).
 */
export function parseHistoryScope(q: { year?: string | null; month?: string | null; week?: string | null; session?: string | null }): HistoryScope {
  if (q.session && UUID.test(q.session)) return { level: 'session', id: q.session.toLowerCase() };
  if (q.week && DAY.test(q.week)) {
    const d = dateOfKey(q.week);
    if (dayKey(d) === q.week) return { level: 'week', week: weekKeyOf(d) };
  }
  const m = q.month ? MONTH.exec(q.month) : null;
  if (m) return { level: 'month', year: Number(m[1]), month: Number(m[2]) };
  if (q.year && YEAR.test(q.year)) return { level: 'year', year: Number(q.year) };
  return { level: 'all' };
}

/** The query string of a History scope — one parameter, the deepest level. */
export function historyScopeSearch(scope: HistoryScope): string {
  const base = '?tab=training&view=history';
  if (scope.level === 'year') return `${base}&year=${scope.year}`;
  if (scope.level === 'month') return `${base}&month=${scope.year}-${pad(scope.month)}`;
  if (scope.level === 'week') return `${base}&week=${scope.week}`;
  if (scope.level === 'session') return `${base}&session=${scope.id}`;
  return base;
}

/** The way up: a week's month (the month its Monday is in), a month's year, a year's History. */
export function scopeTrail(scope: HistoryScope, sessionStartedAt?: string | null): HistoryScope[] {
  if (scope.level === 'all') return [];
  // A session's way up is its week's — known once the session has loaded; until then, History.
  if (scope.level === 'session') {
    const d = sessionStartedAt ? new Date(sessionStartedAt) : null;
    if (!d || Number.isNaN(d.getTime())) return [{ level: 'all' }];
    const week: HistoryScope = { level: 'week', week: weekKeyOf(d) };
    return [...scopeTrail(week), week];
  }
  if (scope.level === 'year') return [{ level: 'all' }];
  if (scope.level === 'month') return [{ level: 'all' }, { level: 'year', year: scope.year }];
  const monday = dateOfKey(scope.week);
  return [{ level: 'all' }, { level: 'year', year: monday.getFullYear() }, { level: 'month', year: monday.getFullYear(), month: monday.getMonth() + 1 }];
}

// ── Words ───────────────────────────────────────────────────────────────────

/** "45 min", "1 h 30 min", "96 h" — a total, never a stopwatch. */
export function totalTimeLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h >= 10 || m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "Nov 9 – 15", "Nov 30 – Dec 6", "Nov 30" (one day). */
export function dayRangeLabel(from: string, to: string, locale: string = 'en-US'): string {
  const a = dateOfKey(from);
  const b = dateOfKey(to);
  const short = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  if (from === to) return short(a);
  return a.getMonth() === b.getMonth() ? `${short(a)} – ${b.getDate()}` : `${short(a)} – ${short(b)}`;
}

export function monthLabel(year: number, month: number, withYear: boolean, locale: string = 'en-US'): string {
  return new Date(year, month - 1, 1, 12).toLocaleDateString(locale, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
}
