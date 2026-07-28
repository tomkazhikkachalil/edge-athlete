import { describe, it, expect } from 'vitest';
import {
  monthMatrix,
  weekDays,
  minutesIntoDay,
  localDayKey,
  allDayDayLabels,
  eventOverlapsDay,
  assignLanes,
} from '../grid';

const timed = (starts: string, ends: string) => ({
  starts_at: starts, ends_at: ends, all_day: false, timezone: 'UTC',
});

describe('monthMatrix', () => {
  it('always returns 6 weeks of 7 days', () => {
    for (const focus of [
      new Date(2026, 1, 10),  // Feb 2026 (28 days, starts Sunday)
      new Date(2024, 1, 10),  // Feb 2024 (leap)
      new Date(2026, 6, 15),  // Jul 2026
      new Date(2026, 10, 1),  // Nov 2026 (starts Sunday)
    ]) {
      const m = monthMatrix(focus);
      expect(m.length).toBe(6);
      expect(m.every(w => w.length === 7)).toBe(true);
    }
  });

  it('starts on the Sunday on/before the 1st and is contiguous', () => {
    const m = monthMatrix(new Date(2026, 6, 15)); // July 2026; the 1st is a Wednesday
    expect(m[0][0].getDay()).toBe(0);
    expect(localDayKey(m[0][0])).toBe('2026-06-28');
    expect(localDayKey(m[0][3])).toBe('2026-07-01');
    expect(localDayKey(m[5][6])).toBe('2026-08-08');
  });

  it('a month starting on Sunday begins with the 1st', () => {
    const m = monthMatrix(new Date(2026, 1, 14)); // Feb 2026 starts Sunday
    expect(localDayKey(m[0][0])).toBe('2026-02-01');
  });
});

describe('weekDays', () => {
  it('returns the Sunday-start week containing the focus', () => {
    const days = weekDays(new Date(2026, 6, 29)); // Wed Jul 29 2026
    expect(days.length).toBe(7);
    expect(localDayKey(days[0])).toBe('2026-07-26');
    expect(localDayKey(days[6])).toBe('2026-08-01');
  });
});

describe('minutesIntoDay', () => {
  it('computes minutes past local midnight', () => {
    expect(minutesIntoDay(new Date(2026, 0, 1, 0, 0))).toBe(0);
    expect(minutesIntoDay(new Date(2026, 0, 1, 7, 30))).toBe(450);
    expect(minutesIntoDay(new Date(2026, 0, 1, 23, 59))).toBe(1439);
  });
});

describe('allDayDayLabels', () => {
  it('labels days in the EVENT time zone regardless of runtime zone', () => {
    // Tokyo all-day event July 30: 2026-07-29T15:00Z → 2026-07-30T15:00Z
    const event = {
      starts_at: '2026-07-29T15:00:00.000Z',
      ends_at: '2026-07-30T15:00:00.000Z',
      all_day: true,
      timezone: 'Asia/Tokyo',
    };
    expect(allDayDayLabels(event)).toEqual(['2026-07-30']);
  });

  it('multi-day span, end exclusive', () => {
    const event = {
      starts_at: '2026-07-01T00:00:00.000Z',
      ends_at: '2026-07-04T00:00:00.000Z',
      all_day: true,
      timezone: 'UTC',
    };
    expect(allDayDayLabels(event)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });
});

describe('eventOverlapsDay', () => {
  it('handles events crossing local midnight', () => {
    // 10pm local → 2am next day local (runtime local zone)
    const start = new Date(2026, 6, 10, 22, 0);
    const end = new Date(2026, 6, 11, 2, 0);
    const event = timed(start.toISOString(), end.toISOString());
    expect(eventOverlapsDay(event, new Date(2026, 6, 10))).toBe(true);
    expect(eventOverlapsDay(event, new Date(2026, 6, 11))).toBe(true);
    expect(eventOverlapsDay(event, new Date(2026, 6, 12))).toBe(false);
  });

  it('an event ending exactly at midnight does not bleed into the next day', () => {
    const start = new Date(2026, 6, 10, 22, 0);
    const end = new Date(2026, 6, 11, 0, 0);
    const event = timed(start.toISOString(), end.toISOString());
    expect(eventOverlapsDay(event, new Date(2026, 6, 11))).toBe(false);
  });
});

describe('assignLanes', () => {
  it('disjoint events all get one full-width lane', () => {
    const laid = assignLanes([
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
      timed('2026-07-10T11:00:00Z', '2026-07-10T12:00:00Z'),
    ]);
    expect(laid.every(l => l.laneIndex === 0 && l.laneCount === 1)).toBe(true);
  });

  it('contained event (A ⊂ B) splits into two lanes', () => {
    const big = timed('2026-07-10T09:00:00Z', '2026-07-10T12:00:00Z');
    const small = timed('2026-07-10T10:00:00Z', '2026-07-10T11:00:00Z');
    const laid = assignLanes([small, big]);
    const bigLaid = laid.find(l => l.event === big)!;
    const smallLaid = laid.find(l => l.event === small)!;
    expect(bigLaid.laneIndex).toBe(0);         // longer-first at same cluster
    expect(smallLaid.laneIndex).toBe(1);
    expect(bigLaid.laneCount).toBe(2);
    expect(smallLaid.laneCount).toBe(2);
  });

  it('chain A-B-C where A and C are disjoint reuses lanes, cluster width 2', () => {
    const a = timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z');
    const b = timed('2026-07-10T09:30:00Z', '2026-07-10T11:00:00Z');
    const c = timed('2026-07-10T10:00:00Z', '2026-07-10T10:30:00Z');
    const laid = assignLanes([a, b, c]);
    const [la, lb, lc] = [a, b, c].map(e => laid.find(l => l.event === e)!);
    expect(la.laneIndex).toBe(0);
    expect(lb.laneIndex).toBe(1);
    expect(lc.laneIndex).toBe(0); // reuses A's lane after A ends
    expect([la.laneCount, lb.laneCount, lc.laneCount]).toEqual([2, 2, 2]);
  });

  it('separate clusters reset lane counts', () => {
    const laid = assignLanes([
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
      timed('2026-07-10T13:00:00Z', '2026-07-10T14:00:00Z'),
    ]);
    expect(laid[0].laneCount).toBe(2);
    expect(laid[1].laneCount).toBe(2);
    expect(laid[2].laneCount).toBe(1);
    expect(laid[2].laneIndex).toBe(0);
  });

  it('identical times stack deterministically', () => {
    const laid = assignLanes([
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
      timed('2026-07-10T09:00:00Z', '2026-07-10T10:00:00Z'),
    ]);
    expect(laid.map(l => l.laneIndex).sort()).toEqual([0, 1, 2]);
    expect(laid.every(l => l.laneCount === 3)).toBe(true);
  });
});
