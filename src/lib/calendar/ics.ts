// iCalendar (RFC 5545) generation — pure, dependency-free, unit-tested.
// Used by the per-event "Add to calendar" download and the subscribe feed.
// Materialized occurrences mean NO RRULE is ever needed: every occurrence
// is its own VEVENT with a stable UID, so subscribed calendars replace
// rather than duplicate on refresh. Lines are CRLF-separated and folded at
// 75 OCTETS (UTF-8-aware — never split inside a multibyte sequence).

import { wallClockInZone } from './recurrence';

const CRLF = '\r\n';

/** Escape TEXT values: backslash, semicolon, comma, newlines. */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets with space-prefixed continuations. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = 75;
  for (const char of line) { // iterates code points, never splits surrogates
    const charOctets = encoder.encode(char).length;
    if (currentOctets + charOctets > limit) {
      out.push(current);
      current = ' ';
      currentOctets = 1;
      limit = 75;
    }
    current += char;
    currentOctets += charOctets;
  }
  if (current) out.push(current);
  return out.join(CRLF);
}

/** UTC instant → YYYYMMDDTHHMMSSZ. */
export function formatIcsInstantUtc(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** All-day date in the EVENT's zone → YYYYMMDD (VALUE=DATE). */
export function formatIcsDate(ms: number, timeZone: string): string {
  const w = wallClockInZone(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${w.y}${pad(w.m)}${pad(w.d)}`;
}

export interface VEventInput {
  uid: string;
  dtstampMs: number;
  startMs: number;
  endMs: number;
  allDay: boolean;
  timezone: string;
  title: string;
  description?: string | null;
  location?: string | null;
  cancelled?: boolean;
}

export function buildVEvent(input: VEventInput): string {
  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(`UID:${icsEscape(input.uid)}`);
  lines.push(`DTSTAMP:${formatIcsInstantUtc(input.dtstampMs)}`);
  if (input.allDay) {
    // Stored bounds are local midnights (end exclusive) — maps directly to
    // VALUE=DATE with exclusive DTEND.
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(input.startMs, input.timezone)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(input.endMs, input.timezone)}`);
  } else {
    lines.push(`DTSTART:${formatIcsInstantUtc(input.startMs)}`);
    lines.push(`DTEND:${formatIcsInstantUtc(input.endMs)}`);
  }
  lines.push(`SUMMARY:${icsEscape(input.title)}`);
  if (input.description) lines.push(`DESCRIPTION:${icsEscape(input.description)}`);
  if (input.location) lines.push(`LOCATION:${icsEscape(input.location)}`);
  lines.push(`STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines.map(foldLine).join(CRLF);
}

export function buildCalendar(
  vevents: string[],
  opts: { name?: string; feedHints?: boolean } = {}
): string {
  const head: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Edge Athlete//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts.name) head.push(`X-WR-CALNAME:${icsEscape(opts.name)}`);
  if (opts.feedHints) {
    head.push('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    head.push('X-PUBLISHED-TTL:PT1H');
  }
  return [
    head.map(foldLine).join(CRLF),
    ...vevents,
    'END:VCALENDAR',
  ].join(CRLF) + CRLF;
}
