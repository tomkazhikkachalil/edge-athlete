import { describe, it, expect } from 'vitest';
import { buildEventTimestamps, formPartsFromEvent } from '../form-times';

const NY = 'America/New_York';
const DENVER = 'America/Denver';
const TOKYO = 'Asia/Tokyo';

describe('buildEventTimestamps', () => {
  it('anchors wall clock in the given zone, not the runner zone', () => {
    // 7:00 PM in Denver on Jul 15 2026 (MDT, UTC-6) = 01:00Z next day.
    const out = buildEventTimestamps(
      { date: '2026-07-15', startTime: '19:00', endTime: '20:30', allDay: false },
      DENVER
    );
    expect(out).toEqual({
      starts_at: '2026-07-16T01:00:00.000Z',
      ends_at: '2026-07-16T02:30:00.000Z',
    });
  });

  it('same wall clock in a different zone yields a different instant', () => {
    const denver = buildEventTimestamps(
      { date: '2026-07-15', startTime: '19:00', endTime: '20:00', allDay: false },
      DENVER
    )!;
    const tokyo = buildEventTimestamps(
      { date: '2026-07-15', startTime: '19:00', endTime: '20:00', allDay: false },
      TOKYO
    )!;
    expect(denver.starts_at).not.toBe(tokyo.starts_at);
    // Tokyo (UTC+9, no DST): 19:00 on Jul 15 = 10:00Z.
    expect(tokyo.starts_at).toBe('2026-07-15T10:00:00.000Z');
  });

  it('rolls an end at/before the start to the next day (past midnight)', () => {
    const out = buildEventTimestamps(
      { date: '2026-07-15', startTime: '22:00', endTime: '01:00', allDay: false },
      NY
    )!;
    // 10pm EDT Jul 15 = 02:00Z Jul 16; 1am EDT Jul 16 = 05:00Z Jul 16.
    expect(out.starts_at).toBe('2026-07-16T02:00:00.000Z');
    expect(out.ends_at).toBe('2026-07-16T05:00:00.000Z');
  });

  it('all-day = zone-midnight to next zone-midnight, end exclusive', () => {
    const out = buildEventTimestamps(
      { date: '2026-07-15', startTime: '', endTime: '', allDay: true },
      TOKYO
    )!;
    // Tokyo midnight Jul 15 = 15:00Z Jul 14.
    expect(out.starts_at).toBe('2026-07-14T15:00:00.000Z');
    expect(out.ends_at).toBe('2026-07-15T15:00:00.000Z');
  });

  it('all-day handles month rollover on the exclusive end', () => {
    const out = buildEventTimestamps(
      { date: '2026-01-31', startTime: '', endTime: '', allDay: true },
      NY
    )!;
    // Next NY midnight is Feb 1 (EST, UTC-5).
    expect(out.ends_at).toBe('2026-02-01T05:00:00.000Z');
  });

  it('spring-forward gap start lands after the gap (recurrence semantics)', () => {
    // 2:30 AM on Mar 8 2026 does not exist in New York (2:00→3:00 jump).
    const out = buildEventTimestamps(
      { date: '2026-03-08', startTime: '02:30', endTime: '04:00', allDay: false },
      NY
    )!;
    // The solver takes the LATER candidate: 3:30 AM EDT = 07:30Z.
    expect(out.starts_at).toBe('2026-03-08T07:30:00.000Z');
  });

  it('fall-back ambiguous wall time resolves to the EARLIER instant', () => {
    // 1:30 AM on Nov 1 2026 happens twice in New York; earlier = EDT (UTC-4).
    const out = buildEventTimestamps(
      { date: '2026-11-01', startTime: '01:30', endTime: '02:30', allDay: false },
      NY
    )!;
    expect(out.starts_at).toBe('2026-11-01T05:30:00.000Z');
  });

  it('returns null on unparseable parts', () => {
    expect(
      buildEventTimestamps({ date: '', startTime: '10:00', endTime: '11:00', allDay: false }, NY)
    ).toBeNull();
    expect(
      buildEventTimestamps({ date: '2026-07-15', startTime: 'xx', endTime: '11:00', allDay: false }, NY)
    ).toBeNull();
  });
});

describe('formPartsFromEvent', () => {
  it("shows the event's wall clock in its OWN zone regardless of runner zone", () => {
    const parts = formPartsFromEvent({
      starts_at: '2026-07-16T01:00:00.000Z', // 7:00 PM Jul 15 in Denver
      ends_at: '2026-07-16T02:30:00.000Z',
      all_day: false,
      timezone: DENVER,
    });
    expect(parts).toEqual({
      date: '2026-07-15',
      startTime: '19:00',
      endTime: '20:30',
      allDay: false,
    });
  });

  it('all-day events land on their zone date with midnight bounds', () => {
    const parts = formPartsFromEvent({
      starts_at: '2026-07-14T15:00:00.000Z', // Tokyo midnight Jul 15
      ends_at: '2026-07-15T15:00:00.000Z',
      all_day: true,
      timezone: TOKYO,
    });
    expect(parts.date).toBe('2026-07-15');
    expect(parts.startTime).toBe('00:00');
    expect(parts.endTime).toBe('00:00');
    expect(parts.allDay).toBe(true);
  });

  it('round-trips with buildEventTimestamps', () => {
    const built = buildEventTimestamps(
      { date: '2026-12-24', startTime: '08:15', endTime: '09:45', allDay: false },
      NY
    )!;
    const parts = formPartsFromEvent({ ...built, all_day: false, timezone: NY });
    expect(parts).toEqual({
      date: '2026-12-24',
      startTime: '08:15',
      endTime: '09:45',
      allDay: false,
    });
  });
});
