// Calendar grid math — pure, DOM-free, unit-tested. All functions work on
// real Date instants; the ONLY sanctioned way to get an all-day event's
// calendar days is allDayDayLabels(), which formats the stored bounds in
// the EVENT's time zone (house rule: never `new Date('YYYY-MM-DD')`, and
// never derive an all-day date from viewer-local getters — that is exactly
// the off-by-one bug across time zones).

import {
  addDays,
  startOfDay,
  endOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

export interface CalendarEventLike {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
}

/** Always 6 weeks × 7 days, Sunday-start, covering the focus month. */
export function monthMatrix(focus: Date): Date[][] {
  const first = startOfWeek(startOfMonth(focus), { weekStartsOn: 0 });
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(addDays(first, w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}

/** The 7 days (Sunday-start) of the focus date's week. */
export function weekDays(focus: Date): Date[] {
  const first = startOfWeek(focus, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** Minutes past local midnight for positioning in a 1440-minute column. */
export function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 'YYYY-MM-DD' of an instant in a zone (en-CA gives ISO ordering). */
export function dayKeyInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/** Viewer-local 'YYYY-MM-DD' key for a Date (string-built, TZ-safe). */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The calendar days an all-day event covers, as 'YYYY-MM-DD' keys in the
 * EVENT's time zone. End is exclusive (midnight after the last day).
 */
export function allDayDayLabels(event: CalendarEventLike): string[] {
  const startMs = Date.parse(event.starts_at);
  const endMs = Date.parse(event.ends_at);
  const labels: string[] = [];
  // Step in 24h increments from the start; DST shifts can't skip a day
  // label because we re-format each instant in the event zone.
  for (let ms = startMs; ms < endMs; ms += 86_400_000) {
    const key = dayKeyInZone(ms, event.timezone);
    if (!labels.includes(key)) labels.push(key);
  }
  return labels;
}

/** Does the event intersect the viewer-local calendar day? */
export function eventOverlapsDay(event: CalendarEventLike, day: Date): boolean {
  if (event.all_day) {
    return allDayDayLabels(event).includes(localDayKey(day));
  }
  const startMs = Date.parse(event.starts_at);
  const endMs = Date.parse(event.ends_at);
  return startMs <= endOfDay(day).getTime() && endMs > startOfDay(day).getTime();
}

export interface LaidOutEvent<T extends CalendarEventLike = CalendarEventLike> {
  event: T;
  laneIndex: number;
  laneCount: number;
}

/**
 * Side-by-side layout for overlapping timed events in a Week/Day column.
 * Sweep: sort by start (then longer first); assign each event the first
 * lane whose last event has ended, else open a new lane. A cluster closes
 * when no event is still running; every member of a cluster shares the
 * cluster's max lane count, so widths line up like Google Calendar.
 */
export function assignLanes<T extends CalendarEventLike>(events: T[]): LaidOutEvent<T>[] {
  const sorted = [...events].sort((a, b) => {
    const startDiff = Date.parse(a.starts_at) - Date.parse(b.starts_at);
    if (startDiff !== 0) return startDiff;
    return Date.parse(b.ends_at) - Date.parse(a.ends_at); // longer first
  });

  const out: LaidOutEvent<T>[] = [];
  const laneEnds: number[] = [];
  let cluster: LaidOutEvent<T>[] = [];
  let clusterMaxEnd = -Infinity;

  const closeCluster = () => {
    const laneCount = cluster.reduce((max, e) => Math.max(max, e.laneIndex + 1), 0);
    for (const item of cluster) item.laneCount = laneCount;
    cluster = [];
    laneEnds.length = 0;
    clusterMaxEnd = -Infinity;
  };

  for (const event of sorted) {
    const startMs = Date.parse(event.starts_at);
    const endMs = Date.parse(event.ends_at);
    if (cluster.length > 0 && startMs >= clusterMaxEnd) closeCluster();

    let laneIndex = laneEnds.findIndex(end => end <= startMs);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(endMs);
    } else {
      laneEnds[laneIndex] = endMs;
    }
    const item: LaidOutEvent<T> = { event, laneIndex, laneCount: 1 };
    cluster.push(item);
    out.push(item);
    clusterMaxEnd = Math.max(clusterMaxEnd, endMs);
  }
  if (cluster.length > 0) closeCluster();
  return out;
}
