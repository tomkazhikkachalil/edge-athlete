/**
 * An event as an .ics file — the pure half (Events program, phase 2b, B2):
 * one VEVENT per non-cancelled round, all-day on the round's DATE (the 057
 * convention through `buildVEvent`'s VALUE=DATE path — a `scheduled_on` is
 * a DATE, never an instant), the tournament's "Round n of N" in the title,
 * the course as the location, the round's name in the description. The
 * whole event cancelled → every VEVENT STATUS:CANCELLED. The subscribe
 * feed stays rows-only (its charter); this is the download.
 */
import { buildCalendar, buildVEvent } from '@/lib/calendar/ics';
import { roundSuffix } from '@/lib/calendar/sport-event-overlay';
import { holesLabel } from './format';

export interface IcsEventInput {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

export interface IcsRoundInput {
  id: string;
  sequence: number;
  scheduled_on: string;
  status: string;
  holes: number;
  starting_hole: number;
  course_name: string;
  name?: string | null;
  updated_at: string;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The rounds that make the file: every non-cancelled one, in sequence order, with a clean date. */
export function icsRounds(rounds: ReadonlyArray<IcsRoundInput>): IcsRoundInput[] {
  return [...rounds].filter(r => r.status !== 'cancelled' && YMD_RE.test(r.scheduled_on)).sort((a, b) => a.sequence - b.sequence);
}

export function sportEventIcs(event: IcsEventInput, rounds: ReadonlyArray<IcsRoundInput>): string {
  const active = icsRounds(rounds);
  const vevents = active.map(round => {
    const [, y, m, d] = YMD_RE.exec(round.scheduled_on) as RegExpExecArray;
    const startMs = Date.UTC(Number(y), Number(m) - 1, Number(d));
    const detail = [round.name, holesLabel(round.holes, round.starting_hole)].filter(Boolean).join(' · ');
    return buildVEvent({
      uid: `sport-event-round:${round.id}@edge-athlete`,
      dtstampMs: Date.parse(round.updated_at) || Date.parse(event.updated_at) || startMs,
      startMs,
      endMs: startMs + 86_400_000,
      allDay: true,
      timezone: 'UTC',
      title: `${event.name}${roundSuffix(round.sequence, active.length)}`,
      description: detail || null,
      location: round.course_name,
      cancelled: event.status === 'cancelled',
    });
  });
  return buildCalendar(vevents, { name: event.name });
}

/** "spring-open.ics" */
export function icsFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'event'}.ics`;
}
