/**
 * ICS (RFC 5545) parsing — the READ half of src/lib/calendar/ics.ts, pure
 * and node-tested (phase 6c I1). Scope: what a schedule import needs from
 * a calendar export — VEVENT blocks with DTSTART (and DTEND), SUMMARY,
 * LOCATION, UID — nothing more. Deliberately NOT a full calendar engine:
 * RRULE events are refused per row ("expand them in your calendar first"),
 * all-day (VALUE=DATE) events are refused for scheduling (a game needs a
 * start time). Unknown properties are ignored. Never throws.
 */

export interface IcsEvent {
  index: number;
  uid: string | null;
  summary: string;
  location: string | null;
  /** Wall-clock start as the calendar wrote it (before any zone math). */
  start: { y: number; m: number; d: number; hh: number; mm: number };
  /** IANA zone the start is expressed in: 'UTC' for a trailing Z, the
   *  TZID when given, null for a floating time (the caller's zone). */
  timeZone: string | null;
}

export interface IcsParseResult {
  events: IcsEvent[];
  errors: { index: number; error: string }[];
}

/** RFC 5545 §3.1 unfolding: CRLF (or LF) followed by a space/tab joins. */
export function unfoldIcs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** The inverse of icsEscape: \\n → newline, \\, \; \\\\ unescaped. */
export function icsUnescape(value: string): string {
  return value.replace(/\\([\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProp(line: string): Prop | null {
  const colon = line.indexOf(':');
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

const DT_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;

export function parseIcs(text: string): IcsParseResult {
  const events: IcsEvent[] = [];
  const errors: { index: number; error: string }[] = [];
  const lines = unfoldIcs(text);
  let inEvent = false;
  let index = 0;
  let cur: Record<string, Prop> = {};
  let hasRrule = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true;
      index += 1;
      cur = {};
      hasRrule = false;
      continue;
    }
    if (line.toUpperCase() === 'END:VEVENT') {
      if (!inEvent) continue;
      inEvent = false;
      const summary = cur.SUMMARY ? icsUnescape(cur.SUMMARY.value).trim() : '';
      const dtstart = cur.DTSTART;
      if (hasRrule) {
        errors.push({ index, error: 'recurring events are not supported — expand them in your calendar first' });
        continue;
      }
      if (!dtstart) {
        errors.push({ index, error: 'event has no start' });
        continue;
      }
      if ((dtstart.params.VALUE ?? '').toUpperCase() === 'DATE' || /^\d{8}$/.test(dtstart.value)) {
        errors.push({ index, error: `"${summary || 'event'}" is all-day — a game needs a start time` });
        continue;
      }
      const m = DT_RE.exec(dtstart.value.trim());
      if (!m) {
        errors.push({ index, error: `"${summary || 'event'}" has an unreadable start (${dtstart.value})` });
        continue;
      }
      if (!summary) {
        errors.push({ index, error: 'event has no summary (the "Home vs Away" line)' });
        continue;
      }
      events.push({
        index,
        uid: cur.UID ? cur.UID.value.trim() : null,
        summary,
        location: cur.LOCATION ? icsUnescape(cur.LOCATION.value).trim() || null : null,
        start: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: Number(m[4]), mm: Number(m[5]) },
        timeZone: m[7] === 'Z' ? 'UTC' : (dtstart.params.TZID ?? null),
      });
      continue;
    }
    if (!inEvent) continue;
    const prop = parseProp(line);
    if (!prop) continue;
    if (prop.name === 'RRULE' || prop.name === 'RDATE') hasRrule = true;
    if (prop.name === 'SUMMARY' || prop.name === 'DTSTART' || prop.name === 'DTEND' || prop.name === 'LOCATION' || prop.name === 'UID') {
      cur[prop.name] = prop;
    }
  }
  return { events, errors };
}

/** "Home vs Away" | "Home v Away" | "Home - Away" | "Home @ Away" (the @
 *  form is written from the away side and swaps). Null when no matchup
 *  can be read. Pure. */
export function summaryToMatchup(summary: string): { home: string; away: string } | null {
  const s = summary.trim();
  const at = /^(.+?)\s+@\s+(.+)$/.exec(s);
  if (at) return { home: at[2].trim(), away: at[1].trim() };
  const vs = /^(.+?)\s+(?:vs\.?|v\.?|versus|-|–|—)\s+(.+)$/i.exec(s);
  if (vs) return { home: vs[1].trim(), away: vs[2].trim() };
  return null;
}
