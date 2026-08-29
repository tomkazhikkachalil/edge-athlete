// Venue-time display + zone-picker helpers — the "dual display" half of the
// venue-entry contract: the grid positions events on the VIEWER's clock, and
// these helpers surface the venue's wall clock wherever it differs. Pure and
// client-safe; formatters are cached per zone because month/week views render
// hundreds of chips per pass.

import { wallClockInZone } from './recurrence';

/** Curated fallback for engines without Intl.supportedValuesOf (pre-2022). */
const FALLBACK_ZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles',
  'America/Phoenix', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Toronto', 'America/Halifax', 'America/St_Johns',
  'America/Mexico_City', 'America/Bogota', 'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Dublin',
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Stockholm', 'Europe/Athens', 'Europe/Moscow', 'Africa/Cairo',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney',
  'Pacific/Auckland', 'UTC',
];

let cachedViewerZone: string | null = null;

/** The browser's IANA zone, memoized (resolvedOptions() is not free). */
export function viewerTimeZone(): string {
  if (!cachedViewerZone) {
    cachedViewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return cachedViewerZone;
}

/**
 * Zones for the picker: the full IANA list where the engine provides it,
 * else the curated fallback — ALWAYS unioned with the current selection and
 * the viewer's zone so an existing value never vanishes from the select.
 */
export function listTimeZones(currentZone: string): string[] {
  const base: string[] =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : FALLBACK_ZONES;
  const set = new Set(base);
  set.add(currentZone);
  set.add(viewerTimeZone());
  set.add('UTC'); // the engine's canonical list spells it Etc/UTC
  return [...set].sort();
}

const labelFormatterCache = new Map<string, Intl.DateTimeFormat>();
function labelFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = labelFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    labelFormatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * The zone's short name ("MDT") at a given instant — DST makes this
 * date-dependent, so callers pass the event's date, not "now".
 */
export function zoneShortName(timeZone: string, ms: number = Date.now()): string {
  try {
    const parts = labelFormatter(timeZone).formatToParts(new Date(ms));
    return parts.find(p => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * "7:00 PM MDT" — the event's start in its OWN zone, or null when there is
 * nothing to add: all-day events, an equal or alias zone, or any zone whose
 * wall clock currently matches the viewer's (America/Phoenix vs Denver in
 * winter — a label repeating the visible time is noise, not information).
 * `viewerTz` is injectable so tests never depend on the runner's zone.
 */
export function venueTimeLabel(
  e: { starts_at: string; all_day: boolean; timezone: string },
  viewerTz: string = viewerTimeZone()
): string | null {
  if (e.all_day || !e.timezone || e.timezone === viewerTz) return null;
  const ms = Date.parse(e.starts_at);
  if (!Number.isFinite(ms)) return null;
  try {
    const venue = wallClockInZone(ms, e.timezone);
    const viewer = wallClockInZone(ms, viewerTz);
    if (venue.hh === viewer.hh && venue.mm === viewer.mm && venue.d === viewer.d) return null;
    return labelFormatter(e.timezone).format(new Date(ms));
  } catch {
    return null; // malformed zone string — degrade to viewer-local only
  }
}
