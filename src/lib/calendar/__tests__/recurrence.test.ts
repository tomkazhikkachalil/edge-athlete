import { describe, it, expect } from 'vitest';
import {
  zonedWallClockToUtc,
  wallClockInZone,
  generateOccurrences,
  validateRecurrenceInput,
  applyWallTime,
  wallDurationMinutes,
  describeRecurrence,
  MAX_OCCURRENCES,
  type SeriesRule,
} from '../recurrence';

const NY = 'America/New_York';

const rule = (overrides: Partial<SeriesRule>): SeriesRule => ({
  freq: 'weekly',
  interval_n: 1,
  byweekday: null,
  ends: 'count',
  until_at: null,
  count_n: 4,
  ...overrides,
});

describe('zonedWallClockToUtc', () => {
  it('exact for normal times (NY winter/summer, Tokyo, UTC)', () => {
    // EST is UTC-5, EDT is UTC-4, Tokyo UTC+9.
    expect(zonedWallClockToUtc(2026, 1, 15, 18, 0, NY)).toBe(Date.UTC(2026, 0, 15, 23, 0));
    expect(zonedWallClockToUtc(2026, 7, 15, 18, 0, NY)).toBe(Date.UTC(2026, 6, 15, 22, 0));
    expect(zonedWallClockToUtc(2026, 7, 15, 18, 0, 'Asia/Tokyo')).toBe(Date.UTC(2026, 6, 15, 9, 0));
    expect(zonedWallClockToUtc(2026, 7, 15, 18, 0, 'UTC')).toBe(Date.UTC(2026, 6, 15, 18, 0));
  });

  it('nonexistent spring-forward time lands AFTER the gap (later candidate)', () => {
    // 2026-03-08 02:30 America/New_York does not exist (2:00→3:00 jump).
    const ms = zonedWallClockToUtc(2026, 3, 8, 2, 30, NY);
    const wall = wallClockInZone(ms, NY);
    expect(`${wall.hh}:${wall.mm}`).toBe('3:30'); // 03:30 EDT
    expect(ms).toBe(Date.UTC(2026, 2, 8, 7, 30));
  });

  it('ambiguous fall-back time resolves to the EARLIER instant', () => {
    // 2026-11-01 01:30 America/New_York occurs twice (EDT then EST).
    const ms = zonedWallClockToUtc(2026, 11, 1, 1, 30, NY);
    expect(ms).toBe(Date.UTC(2026, 10, 1, 5, 30)); // 01:30 EDT (earlier)
  });
});

describe('generateOccurrences — weekly + DST', () => {
  it('weekly 18:00 NY keeps local time across both DST transitions', () => {
    // Tuesdays 18:00-19:30 starting Jan 6 2026, 30 occurrences spans
    // spring-forward (Mar 8) — January instants are 23:00Z (EST), July 22:00Z (EDT).
    const occ = generateOccurrences(
      rule({ ends: 'count', count_n: 30 }),
      { startWall: { y: 2026, m: 1, d: 6, hh: 18, mm: 0 }, durationMin: 90, timeZone: NY },
      {}
    );
    expect(occ.length).toBe(30);
    expect(occ[0].starts_at).toBe(new Date(Date.UTC(2026, 0, 6, 23, 0)).toISOString());
    const july = occ.find(o => o.starts_at.startsWith('2026-07'));
    expect(july).toBeDefined();
    const wall = wallClockInZone(Date.parse(july!.starts_at), NY);
    expect(`${wall.hh}:${wall.mm}`).toBe('18:0');
    // Duration stays 90 wall minutes everywhere.
    for (const o of occ) {
      expect(wallDurationMinutes(o.starts_at, o.ends_at, NY)).toBe(90);
    }
  });

  it('weekly on Tue+Thu emits both days, first occurrence first', () => {
    const occ = generateOccurrences(
      rule({ byweekday: [2, 4], ends: 'count', count_n: 4 }),
      { startWall: { y: 2026, m: 7, d: 28, hh: 10, mm: 0 }, durationMin: 60, timeZone: 'UTC' }, // Tue
      {}
    );
    expect(occ.map(o => o.starts_at.slice(0, 10))).toEqual([
      '2026-07-28', '2026-07-30', '2026-08-04', '2026-08-06',
    ]);
  });

  it('every-2-weeks parity is preserved across afterInstant resumption', () => {
    const template = {
      startWall: { y: 2026, m: 7, d: 28, hh: 10, mm: 0 }, durationMin: 60, timeZone: 'UTC' as string,
    };
    const biweekly = rule({ interval_n: 2, ends: 'count', count_n: 6 });
    const full = generateOccurrences(biweekly, template, {});
    expect(full.map(o => o.starts_at.slice(0, 10))).toEqual([
      '2026-07-28', '2026-08-11', '2026-08-25', '2026-09-08', '2026-09-22', '2026-10-06',
    ]);
    // Resume after the 3rd occurrence: must continue the SAME parity.
    const resumed = generateOccurrences(biweekly, template, {
      afterInstant: Date.parse(full[2].starts_at),
    });
    expect(resumed.map(o => o.starts_at.slice(0, 10))).toEqual([
      '2026-09-08', '2026-09-22', '2026-10-06',
    ]);
  });
});

describe('generateOccurrences — monthly/yearly skip rules', () => {
  it('monthly on the 31st skips shorter months', () => {
    const occ = generateOccurrences(
      rule({ freq: 'monthly', ends: 'count', count_n: 5 }),
      { startWall: { y: 2026, m: 1, d: 31, hh: 9, mm: 0 }, durationMin: 60, timeZone: 'UTC' },
      {}
    );
    expect(occ.map(o => o.starts_at.slice(0, 10))).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31',
    ]);
  });

  it('yearly Feb 29 fires on leap years only', () => {
    const occ = generateOccurrences(
      rule({ freq: 'yearly', ends: 'count', count_n: 3 }),
      { startWall: { y: 2024, m: 2, d: 29, hh: 9, mm: 0 }, durationMin: 60, timeZone: 'UTC' },
      {}
    );
    expect(occ.map(o => o.starts_at.slice(0, 4))).toEqual(['2024', '2028', '2032']);
  });
});

describe('generateOccurrences — termination', () => {
  it('count includes the first occurrence', () => {
    const occ = generateOccurrences(
      rule({ freq: 'daily', ends: 'count', count_n: 3 }),
      { startWall: { y: 2026, m: 7, d: 1, hh: 8, mm: 0 }, durationMin: 30, timeZone: 'UTC' },
      {}
    );
    expect(occ.length).toBe(3);
  });

  it('until is exclusive but includes an occurrence ON the chosen date', () => {
    // until_at = midnight after Jul 15 → Jul 15 occurrence included, Jul 22 not.
    const occ = generateOccurrences(
      rule({ ends: 'until', until_at: new Date(Date.UTC(2026, 6, 16, 0, 0)).toISOString(), count_n: null }),
      { startWall: { y: 2026, m: 7, d: 1, hh: 8, mm: 0 }, durationMin: 30, timeZone: 'UTC' },
      {}
    );
    expect(occ.map(o => o.starts_at.slice(0, 10))).toEqual(['2026-07-01', '2026-07-08', '2026-07-15']);
  });

  it('hard 104 cap holds for daily never-ending series', () => {
    const occ = generateOccurrences(
      rule({ freq: 'daily', ends: 'never', count_n: null }),
      { startWall: { y: 2026, m: 7, d: 1, hh: 8, mm: 0 }, durationMin: 30, timeZone: 'UTC' },
      { horizonInstant: Date.UTC(2027, 6, 1) } // horizon far beyond the cap
    );
    expect(occ.length).toBe(MAX_OCCURRENCES);
  });
});

describe('validateRecurrenceInput', () => {
  const start = new Date(Date.UTC(2026, 6, 28, 22, 0)).toISOString(); // Tue 18:00 NY
  const end = new Date(Date.UTC(2026, 6, 28, 23, 30)).toISOString();

  it('accepts weekly Tue+Thu with count', () => {
    const result = validateRecurrenceInput(
      { freq: 'weekly', interval: 2, byweekday: [2, 4], ends: { kind: 'count', count: 10 } },
      start, end, NY
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.occurrences.length).toBe(10);
      expect(result.rule.interval_n).toBe(2);
    }
  });

  it("rejects weekly days that exclude the event's start day", () => {
    const result = validateRecurrenceInput(
      { freq: 'weekly', byweekday: [1, 3], ends: { kind: 'count', count: 5 } }, // Mon+Wed, starts Tue
      start, end, NY
    );
    expect(result.ok).toBe(false);
  });

  it('rejects byweekday on non-weekly, bad intervals, bad counts', () => {
    expect(validateRecurrenceInput({ freq: 'daily', byweekday: [2] }, start, end, NY).ok).toBe(false);
    expect(validateRecurrenceInput({ freq: 'daily', interval: 0 }, start, end, NY).ok).toBe(false);
    expect(validateRecurrenceInput({ freq: 'daily', ends: { kind: 'count', count: 500 } }, start, end, NY).ok).toBe(false);
  });

  it('rejects until dates beyond two years or before the start', () => {
    expect(validateRecurrenceInput(
      { freq: 'weekly', ends: { kind: 'until', until: '2029-01-01' } }, start, end, NY
    ).ok).toBe(false);
    expect(validateRecurrenceInput(
      { freq: 'weekly', ends: { kind: 'until', until: '2026-01-01' } }, start, end, NY
    ).ok).toBe(false);
  });

  it('defaults: interval 1, weekly byweekday = start day, ends never (horizon-capped)', () => {
    const result = validateRecurrenceInput({ freq: 'weekly' }, start, end, NY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.byweekday).toEqual([2]); // Tuesday
      expect(result.rule.ends).toBe('never');
      expect(result.occurrences.length).toBeGreaterThan(20); // ~26 weeks in horizon
      expect(result.occurrences.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
    }
  });
});

describe('applyWallTime', () => {
  it('applies a new local time keeping the occurrence date, DST-correct', () => {
    // Occurrence on Jul 14 2026 (EDT): 18:00 → move to 19:00, 90 min.
    const occStart = new Date(Date.UTC(2026, 6, 14, 22, 0)).toISOString();
    const moved = applyWallTime(occStart, NY, 19, 0, 90, false);
    expect(moved.starts_at).toBe(new Date(Date.UTC(2026, 6, 14, 23, 0)).toISOString());
    expect(moved.ends_at).toBe(new Date(Date.UTC(2026, 6, 15, 0, 30)).toISOString());
    // Same edit on a January (EST) occurrence: same LOCAL time, different offset.
    const winterStart = new Date(Date.UTC(2026, 0, 13, 23, 0)).toISOString();
    const winterMoved = applyWallTime(winterStart, NY, 19, 0, 90, false);
    expect(winterMoved.starts_at).toBe(new Date(Date.UTC(2026, 0, 14, 0, 0)).toISOString());
  });

  it('all-day keeps midnight bounds', () => {
    const occStart = new Date(Date.UTC(2026, 6, 14, 4, 0)).toISOString(); // midnight NY (EDT)
    const moved = applyWallTime(occStart, NY, 0, 0, 1440, true);
    expect(moved.starts_at).toBe(new Date(Date.UTC(2026, 6, 14, 4, 0)).toISOString());
    expect(moved.ends_at).toBe(new Date(Date.UTC(2026, 6, 15, 4, 0)).toISOString());
  });
});

describe('describeRecurrence', () => {
  it('renders the common patterns', () => {
    expect(describeRecurrence(rule({ interval_n: 1, byweekday: [2, 4], ends: 'never', count_n: null }), NY))
      .toBe('Repeats weekly on Tue, Thu');
    expect(describeRecurrence(rule({ interval_n: 2, byweekday: [2], ends: 'count', count_n: 10 }), NY))
      .toBe('Repeats every 2 weeks on Tue · 10 times');
    expect(describeRecurrence(
      rule({ freq: 'monthly', byweekday: null, ends: 'until', until_at: new Date(Date.UTC(2026, 9, 7, 4, 0)).toISOString(), count_n: null }), NY
    )).toBe('Repeats monthly · until Oct 6, 2026');
    expect(describeRecurrence(rule({ freq: 'daily', byweekday: null, ends: 'never', count_n: null }), NY))
      .toBe('Repeats daily');
  });
});
