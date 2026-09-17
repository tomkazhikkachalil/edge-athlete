import { describe, expect, it } from 'vitest';
import { icsFilename, icsRounds, sportEventIcs } from '../ics';

const event = { id: 'e1', name: 'Spring Open', status: 'open', updated_at: '2026-09-16T10:00:00.000Z' };
const round = (n: number, patch: Record<string, unknown> = {}) => ({ id: `r${n}`, sequence: n, scheduled_on: `2030-06-0${n}`, status: 'scheduled', holes: 18, starting_hole: 1, course_name: 'QA Links', name: null, updated_at: '2026-09-16T10:00:00.000Z', ...patch });

describe('sportEventIcs', () => {
  it('one all-day VEVENT per non-cancelled round on its DATE, the tournament named per round, the course as the location', () => {
    const ics = sportEventIcs(event, [round(1), round(2, { name: 'Final', status: 'live' }), round(3, { status: 'cancelled' })]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:sport-event-round:r1@edge-athlete');
    expect(ics).toContain('DTSTART;VALUE=DATE:20300601');
    expect(ics).toContain('DTEND;VALUE=DATE:20300602');
    expect(ics).toContain('SUMMARY:Spring Open · Round 1 of 2');
    expect(ics).toContain('SUMMARY:Spring Open · Round 2 of 2');
    expect(ics).toContain('DESCRIPTION:Final · 18 holes');
    expect(ics).toContain('LOCATION:QA Links');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('X-WR-CALNAME:Spring Open');
  });
  it('a single round carries no round suffix; a cancelled event marks every VEVENT cancelled; a bad date is left out', () => {
    const one = sportEventIcs(event, [round(1)]);
    expect(one).toContain('SUMMARY:Spring Open\r\n');
    const cancelled = sportEventIcs({ ...event, status: 'cancelled' }, [round(1)]);
    expect(cancelled).toContain('STATUS:CANCELLED');
    expect(icsRounds([round(1, { scheduled_on: '2030-6-1' }), round(2)]).map(r => r.id)).toEqual(['r2']);
  });
  it('a round with a start is a timed VEVENT on UTC instants, the venue time in the description (leftovers PR 8)', () => {
    const ics = sportEventIcs(event, [round(1, { starts_at: '2030-06-02T05:00:00.000Z', timezone: 'Pacific/Honolulu' })]);
    expect(ics).toContain('DTSTART:20300602T050000Z');
    expect(ics).toContain('DTEND:20300602T093000Z');
    expect(ics).toContain('DESCRIPTION:18 holes · Starts 7:00 PM HST');
    expect(ics).not.toContain('VALUE=DATE');
    const noZone = sportEventIcs(event, [round(1, { starts_at: '2030-06-02T05:00:00.000Z' })]);
    expect(noZone).toContain('DTSTART:20300602T050000Z');
    expect(noZone).not.toContain('Starts');
  });
  it('names the file from the event', () => {
    expect(icsFilename('Spring Open 2030!')).toBe('spring-open-2030.ics');
    expect(icsFilename('***')).toBe('event.ics');
  });
});
