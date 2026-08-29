// Form wall-clock ⇄ UTC instants, anchored in an explicit IANA zone — the
// venue-entry contract: the time a user types is the time AT THE EVENT's
// zone, never the browser's. Pure, dependency-free (imports only the
// recurrence primitives), unit-tested. The form used to build instants with
// browser-local `new Date(y, m, d, h, m)`, which was only correct because it
// also stamped the browser zone; a zone picker makes that pairing a lie.

import { wallClockInZone, zonedWallClockToUtc } from './recurrence';

export interface FormTimeParts {
  date: string;      // YYYY-MM-DD (native date input)
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  allDay: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The wall date after (y, m, d) — month/year rollover via a naive-UTC round trip. */
function nextWallDay(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * UTC instants for form wall-clock parts anchored in `timeZone`.
 * All-day: midnight-to-next-midnight in the zone (end exclusive, the 057
 * contract the server validates). An end at/before the start means "past
 * midnight" (10pm–1am) and rolls to the next day. Null on unparseable parts.
 */
export function buildEventTimestamps(
  parts: FormTimeParts,
  timeZone: string
): { starts_at: string; ends_at: string } | null {
  const [y, m, d] = parts.date.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (parts.allDay) {
    const next = nextWallDay(y, m, d);
    return {
      starts_at: new Date(zonedWallClockToUtc(y, m, d, 0, 0, timeZone)).toISOString(),
      ends_at: new Date(zonedWallClockToUtc(next.y, next.m, next.d, 0, 0, timeZone)).toISOString(),
    };
  }
  const [sh, sm] = parts.startTime.split(':').map(Number);
  const [eh, em] = parts.endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return null;
  const start = zonedWallClockToUtc(y, m, d, sh, sm, timeZone);
  let end = zonedWallClockToUtc(y, m, d, eh, em, timeZone);
  if (end <= start) {
    const next = nextWallDay(y, m, d);
    end = zonedWallClockToUtc(next.y, next.m, next.d, eh, em, timeZone);
  }
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
  };
}

/**
 * Form parts showing an event's wall clock IN ITS OWN ZONE — venue-anchored
 * editing. All-day events land on 00:00/00:00 by construction (the stored
 * bounds are zone-midnights); the date must come from the event zone, never
 * viewer-local getters (the grid.ts house rule).
 */
export function formPartsFromEvent(e: {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
}): FormTimeParts {
  const start = wallClockInZone(Date.parse(e.starts_at), e.timezone);
  const end = wallClockInZone(Date.parse(e.ends_at), e.timezone);
  return {
    date: `${start.y}-${pad(start.m)}-${pad(start.d)}`,
    startTime: `${pad(start.hh)}:${pad(start.mm)}`,
    endTime: `${pad(end.hh)}:${pad(end.mm)}`,
    allDay: e.all_day,
  };
}
