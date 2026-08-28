// Family-calendar conflict detection (Wave 2) — pure and node-testable.
// The guardian week strip merges every child's events and asks one question:
// "am I double-booked as a driver?" A conflict is two DISTINCT events whose
// times collide. The caller pre-dedupes by event id, merging childIds — two
// siblings invited to the SAME event is one commitment, never a conflict.
//
// All-day semantics follow the grid.ts house rules: an all-day event's
// starts_at/ends_at are day bounds anchored in the EVENT's zone, so a naive
// Date.parse interval overlap manufactures false conflicts across zones.
// Day membership comes from allDayDayLabels (event zone) and localDayKey
// (viewer zone) — never toISOString.

import {
  allDayDayLabels,
  localDayKey,
  type CalendarEventLike,
} from './grid';

export interface ConflictEvent extends CalendarEventLike {
  id: string;
  title: string;
  /** Every roster child attached to this event (merged by the caller). */
  childIds: string[];
}

export interface ConflictPair {
  /** The two event ids, in input order. */
  ids: [string, string];
  /** Viewer-local 'YYYY-MM-DD' keys of the days the collision touches. */
  dayKeys: string[];
}

/** Viewer-local day keys a timed event touches (walked in local time). */
function timedDayKeys(startMs: number, endMs: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  // End-exclusive: an event ending exactly at midnight doesn't touch the
  // next day.
  while (cursor.getTime() < endMs) {
    keys.push(localDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys.length > 0 ? keys : [localDayKey(new Date(startMs))];
}

function conflictBetween(a: ConflictEvent, b: ConflictEvent): string[] | null {
  if (!a.all_day && !b.all_day) {
    const aStart = Date.parse(a.starts_at);
    const aEnd = Date.parse(a.ends_at);
    const bStart = Date.parse(b.starts_at);
    const bEnd = Date.parse(b.ends_at);
    // Instant overlap, touching endpoints excluded (back-to-back is tight
    // scheduling, not a collision).
    if (aStart < bEnd && bStart < aEnd) {
      const overlapKeys = timedDayKeys(Math.max(aStart, bStart), Math.min(aEnd, bEnd));
      return overlapKeys;
    }
    return null;
  }
  // Any pair involving an all-day event collides on shared calendar DAYS.
  // An all-day tournament vs a 3pm practice IS a conflict a parent wants
  // flagged — the UI may soften it, the helper reports it.
  const aDays = a.all_day
    ? allDayDayLabels(a)
    : timedDayKeys(Date.parse(a.starts_at), Date.parse(a.ends_at));
  const bDays = b.all_day
    ? allDayDayLabels(b)
    : timedDayKeys(Date.parse(b.starts_at), Date.parse(b.ends_at));
  const shared = aDays.filter(d => bDays.includes(d));
  return shared.length > 0 ? shared : null;
}

/**
 * Every colliding pair of distinct events, deterministic input order.
 * O(n²) over at most a family-week of events.
 */
export function findConflicts(events: ConflictEvent[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const dayKeys = conflictBetween(events[i], events[j]);
      if (dayKeys) {
        pairs.push({ ids: [events[i].id, events[j].id], dayKeys });
      }
    }
  }
  return pairs;
}

/** The union of conflict day keys — what the strip highlights. */
export function conflictDayKeys(pairs: ConflictPair[]): Set<string> {
  const keys = new Set<string>();
  for (const pair of pairs) for (const key of pair.dayKeys) keys.add(key);
  return keys;
}
