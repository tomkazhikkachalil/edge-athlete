/**
 * Derivations for the bubble dashboard — the playful layer's numbers. Pure
 * and node-tested, computed client-side from the payloads the tab already
 * fetches; nothing here changes what is tracked or how PRs are detected
 * (that stays in workouts/dashboard.ts and workouts/pr-detection.ts).
 */

import {
  startOfWeek,
  sessionSeconds,
  sessionVolumeLbs,
  type VitalEntryLike,
} from '@/lib/workouts/dashboard';
import { VITAL_METRICS_MAP, formatSecondsToDisplay } from '@/lib/vitals-config';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';

const DAY_MS = 24 * 3600 * 1000;

// ── Active days ──────────────────────────────────────────────────────────────

/**
 * Distinct local days with at least one COMPLETED workout in the current
 * Monday-anchored week — the hero ring's fill (n of 7). Two sessions on one
 * day count once.
 */
export function activeDaysThisWeek(
  sessions: ServerWorkoutSession[],
  now: Date = new Date()
): number {
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = weekStart + 7 * DAY_MS;
  const days = new Set<string>();
  for (const session of sessions) {
    if (session.status !== 'completed') continue;
    const d = new Date(session.started_at);
    const t = d.getTime();
    if (t < weekStart || t >= weekEnd) continue;
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return Math.min(7, days.size);
}

// ── Weekly bars ──────────────────────────────────────────────────────────────

export interface WeekBar {
  /** Local Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  workouts: number;
  volumeLbs: number;
  seconds: number;
  isCurrent: boolean;
}

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The last `weeks` Monday-anchored weeks (oldest first, current week last),
 * each with totals from COMPLETED sessions. Empty weeks render honestly as
 * zeros — a gap is part of the story. Week boundaries step by calendar date,
 * not fixed milliseconds, so DST shifts can't smear a bucket.
 */
export function weeklyBars(
  sessions: ServerWorkoutSession[],
  weeks: number,
  now: Date = new Date()
): WeekBar[] {
  const starts: Date[] = [];
  let cursor = startOfWeek(now);
  for (let i = 0; i < weeks; i++) {
    starts.unshift(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7);
  }

  const barByStart = new Map<number, WeekBar>();
  const bars = starts.map((start, i) => {
    const bar: WeekBar = {
      weekStart: localDateKey(start),
      workouts: 0,
      volumeLbs: 0,
      seconds: 0,
      isCurrent: i === starts.length - 1,
    };
    barByStart.set(start.getTime(), bar);
    return bar;
  });

  for (const session of sessions) {
    if (session.status !== 'completed') continue;
    const bar = barByStart.get(startOfWeek(new Date(session.started_at)).getTime());
    if (!bar) continue;
    bar.workouts += 1;
    bar.volumeLbs += sessionVolumeLbs(session);
    bar.seconds += sessionSeconds(session);
  }

  for (const bar of bars) bar.volumeLbs = Math.round(bar.volumeLbs);
  return bars;
}

// ── Milestones ───────────────────────────────────────────────────────────────

export interface MetricMilestone {
  date: string;
  value: number;
  display: string;
}

function milestoneDisplay(entry: VitalEntryLike, metricKey: string): string {
  if (entry.value_display) return entry.value_display;
  const metric = VITAL_METRICS_MAP[metricKey];
  const value = entry.value as number;
  if (metric?.time_format === 'mm:ss') return formatSecondsToDisplay(value, 'mm:ss');
  if (metric?.time_format === 'decimal_seconds') return `${value} sec`;
  return `${value}${metric?.unit ? ` ${metric.unit}` : ''}`;
}

/**
 * Every entry that set (or tied) the metric's running best, in date order —
 * the "story so far" markers on a progression chart. Ties count, matching
 * latestPB. Body metrics (lower_is_better === null) have no milestones:
 * height isn't a PR.
 */
export function metricMilestones(
  vitals: VitalEntryLike[],
  metricKey: string
): MetricMilestone[] {
  const metric = VITAL_METRICS_MAP[metricKey];
  if (!metric || metric.lower_is_better === null) return [];

  const entries = vitals
    .filter(v => v.metric_key === metricKey && v.value !== null)
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  const milestones: MetricMilestone[] = [];
  let best: number | undefined;
  for (const entry of entries) {
    const value = entry.value as number;
    const beatsOrTies =
      best === undefined || (metric.lower_is_better ? value <= best : value >= best);
    if (!beatsOrTies) continue;
    best = value;
    milestones.push({
      date: entry.recorded_at,
      value,
      display: milestoneDisplay(entry, metricKey),
    });
  }
  return milestones;
}

// ── Recency ──────────────────────────────────────────────────────────────────

/**
 * True when a PB was recorded within the last `days` days — drives "New!"
 * chips. Tolerates up to a day of clock-forward skew: date-only timestamps
 * parse as UTC midnight, which can sit slightly ahead of local "now".
 */
export function isRecentPB(
  recordedAt: string,
  now: Date = new Date(),
  days = 7
): boolean {
  const age = now.getTime() - new Date(recordedAt).getTime();
  return age >= -DAY_MS && age < days * DAY_MS;
}
