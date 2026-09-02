import { describe, expect, it } from 'vitest';
import { icsUnescape, parseIcs, summaryToMatchup, unfoldIcs } from '../ics-parse';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:a1@example',
  'DTSTART;TZID=America/Toronto:20261003T190000',
  'DTEND;TZID=America/Toronto:20261003T210000',
  'SUMMARY:Blazers vs Comets',
  'LOCATION:Kanata Rec Complex\\, Rink 1',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:a2@example',
  'DTSTART:20261010T230000Z',
  'SUMMARY:Comets @ Blazers',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:a3@example',
  'DTSTART;TZID=America/Toronto:20261017T190000',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'SUMMARY:Blazers vs Comets',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:a4@example',
  'DTSTART;VALUE=DATE:20261024',
  'SUMMARY:Season party',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261031T180000',
  'SUMMARY:A very long summary that the exporter folded across',
  '  two lines vs Comets',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ics-parse', () => {
  it('unfolds continuation lines and unescapes values', () => {
    expect(unfoldIcs('A:1\r\n b\r\nC:2')).toEqual(['A:1b', 'C:2']);
    expect(icsUnescape('Rink 1\\, pad A\; late\\nsecond')).toBe('Rink 1, pad A; late\nsecond');
  });

  it('parses TZID, Z and floating starts; refuses RRULE and all-day per row', () => {
    const { events, errors } = parseIcs(ICS);
    expect(events.map(e => e.index)).toEqual([1, 2, 5]);
    expect(events[0]).toMatchObject({
      uid: 'a1@example',
      summary: 'Blazers vs Comets',
      location: 'Kanata Rec Complex, Rink 1',
      start: { y: 2026, m: 10, d: 3, hh: 19, mm: 0 },
      timeZone: 'America/Toronto',
    });
    expect(events[1]).toMatchObject({ summary: 'Comets @ Blazers', start: { hh: 23 }, timeZone: 'UTC' });
    // The folded summary joins; a floating time has no zone.
    expect(events[2].summary).toBe('A very long summary that the exporter folded across two lines vs Comets');
    expect(events[2].timeZone).toBeNull();
    expect(errors).toEqual([
      { index: 3, error: 'recurring events are not supported — expand them in your calendar first' },
      { index: 4, error: '"Season party" is all-day — a game needs a start time' },
    ]);
    expect(parseIcs('')).toEqual({ events: [], errors: [] });
  });

  it('reads matchups in the common forms; @ swaps home/away', () => {
    expect(summaryToMatchup('Blazers vs Comets')).toEqual({ home: 'Blazers', away: 'Comets' });
    expect(summaryToMatchup('Blazers v. Comets')).toEqual({ home: 'Blazers', away: 'Comets' });
    expect(summaryToMatchup('Blazers - Comets')).toEqual({ home: 'Blazers', away: 'Comets' });
    expect(summaryToMatchup('Comets @ Blazers')).toEqual({ home: 'Blazers', away: 'Comets' });
    expect(summaryToMatchup('Practice')).toBeNull();
  });
});
