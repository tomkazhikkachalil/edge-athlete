import { describe, it, expect } from 'vitest';
import {
  icsEscape,
  foldLine,
  formatIcsInstantUtc,
  formatIcsDate,
  buildVEvent,
  buildCalendar,
} from '../ics';

describe('icsEscape', () => {
  it('escapes backslash, semicolon, comma, and newlines', () => {
    expect(icsEscape('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves short lines untouched', () => {
    expect(foldLine('SUMMARY:Practice')).toBe('SUMMARY:Practice');
  });

  it('folds at 75 octets with space continuation', () => {
    const line = 'DESCRIPTION:' + 'a'.repeat(200);
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeLessThanOrEqual(75);
    for (const cont of parts.slice(1)) {
      expect(cont.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(cont).length).toBeLessThanOrEqual(75);
    }
    // Unfolding reproduces the original.
    expect(parts[0] + parts.slice(1).map(p => p.slice(1)).join('')).toBe(line);
  });

  it('never splits inside a multibyte character', () => {
    const line = 'SUMMARY:' + '🏌️‍♂️é漢'.repeat(30);
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      // Round-trips through encode/decode without replacement chars.
      expect(new TextDecoder().decode(new TextEncoder().encode(part))).toBe(part);
    }
  });
});

describe('formatIcsInstantUtc / formatIcsDate', () => {
  it('formats UTC instants', () => {
    expect(formatIcsInstantUtc(Date.UTC(2026, 6, 28, 22, 5, 9))).toBe('20260728T220509Z');
  });

  it('formats all-day dates in the event zone', () => {
    // Midnight July 30 in New York = 04:00Z.
    expect(formatIcsDate(Date.UTC(2026, 6, 30, 4, 0), 'America/New_York')).toBe('20260730');
  });
});

describe('buildVEvent', () => {
  const base = {
    uid: 'abc-123@edge-athlete',
    dtstampMs: Date.UTC(2026, 6, 1, 12, 0),
    startMs: Date.UTC(2026, 6, 28, 22, 0),
    endMs: Date.UTC(2026, 6, 28, 23, 30),
    allDay: false,
    timezone: 'America/New_York',
    title: 'Team Practice',
    location: 'Riverside Field',
  };

  it('emits a timed CONFIRMED event with UTC bounds', () => {
    const v = buildVEvent(base);
    expect(v).toContain('UID:abc-123@edge-athlete');
    expect(v).toContain('DTSTART:20260728T220000Z');
    expect(v).toContain('DTEND:20260728T233000Z');
    expect(v).toContain('SUMMARY:Team Practice');
    expect(v).toContain('LOCATION:Riverside Field');
    expect(v).toContain('STATUS:CONFIRMED');
  });

  it('all-day uses VALUE=DATE with exclusive DTEND in the event zone', () => {
    const v = buildVEvent({
      ...base,
      allDay: true,
      startMs: Date.UTC(2026, 6, 30, 4, 0),  // NY midnight Jul 30
      endMs: Date.UTC(2026, 6, 31, 4, 0),    // exclusive midnight Jul 31
    });
    expect(v).toContain('DTSTART;VALUE=DATE:20260730');
    expect(v).toContain('DTEND;VALUE=DATE:20260731');
  });

  it('cancelled events carry STATUS:CANCELLED', () => {
    expect(buildVEvent({ ...base, cancelled: true })).toContain('STATUS:CANCELLED');
  });
});

describe('buildCalendar', () => {
  it('wraps events with calendar envelope, CRLF line endings', () => {
    const cal = buildCalendar(['BEGIN:VEVENT\r\nEND:VEVENT'], { name: 'Edge Athlete', feedHints: true });
    expect(cal.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(cal.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(cal).toContain('PRODID:-//Edge Athlete//Calendar//EN');
    expect(cal).toContain('X-WR-CALNAME:Edge Athlete');
    expect(cal).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(cal).not.toContain('\n\n');
    // No bare LF lines (every line ends with CRLF).
    expect(cal.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
