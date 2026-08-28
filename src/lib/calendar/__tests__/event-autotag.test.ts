import { describe, it, expect } from 'vitest';
import { eventWindowsFromApi, inferEvent, type EventWindow } from '../event-autotag';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-08-29T14:00:00Z');

const timed = (id: string, startMs: number, endMs: number): EventWindow => ({
  eventId: id, startMs, endMs, title: `event ${id}`,
});
const allDay = (id: string, startMs: number, endMs: number): EventWindow => ({
  eventId: id, startMs, endMs, title: `event ${id}`, allDay: true,
});

describe('inferEvent', () => {
  it('containment in a timed event → high confidence', () => {
    const result = inferEvent(T0 + HOUR, [timed('a', T0, T0 + 2 * HOUR)]);
    expect(result).toEqual({ eventId: 'a', title: 'event a', confidence: 'high' });
  });

  it('maxGap padding: 89min before a timed event matches, 91min does not', () => {
    const events = [timed('a', T0, T0 + HOUR)];
    expect(inferEvent(T0 - 89 * 60_000, events).eventId).toBe('a');
    expect(inferEvent(T0 - 91 * 60_000, events)).toMatchObject({
      eventId: null, reason: 'outside-window',
    });
  });

  it('all-day events get containment ONLY — no padding', () => {
    const events = [allDay('day', T0, T0 + 8 * HOUR)];
    expect(inferEvent(T0 + HOUR, events).eventId).toBe('day');
    expect(inferEvent(T0 - 60_000, events)).toMatchObject({ reason: 'outside-window' });
  });

  it('ambiguity is a REFUSAL: capture inside both an all-day and a timed event', () => {
    const result = inferEvent(T0 + HOUR, [
      allDay('tournament', T0 - 4 * HOUR, T0 + 8 * HOUR),
      timed('practice', T0, T0 + 2 * HOUR),
    ]);
    expect(result).toEqual({ eventId: null, title: null, confidence: 'low', reason: 'ambiguous' });
  });

  it('duplicate rows of the SAME event (two siblings) are one commitment, not ambiguity', () => {
    const result = inferEvent(T0 + HOUR, [
      timed('shared', T0, T0 + 2 * HOUR),
      timed('shared', T0, T0 + 2 * HOUR),
    ]);
    expect(result.eventId).toBe('shared');
  });

  it('deterministic tie-break: earlier start, then lexicographic id — never input order', () => {
    const a = timed('b-later-id', T0, T0 + 2 * HOUR);
    const b = timed('a-earlier-id', T0, T0 + 2 * HOUR);
    // Same window twice with different ids IS ambiguous — use identical
    // windows only via the duplicate rule; tie-break applies to the reduce
    // over duplicates of one distinct id set.
    expect(inferEvent(T0 + HOUR, [a, b])).toMatchObject({ reason: 'ambiguous' });
    // Duplicates of one id reduce deterministically regardless of order.
    expect(inferEvent(T0 + HOUR, [a, { ...a }]).eventId).toBe('b-later-id');
  });

  it('no data → refusal', () => {
    expect(inferEvent(null, [timed('a', T0, T0 + HOUR)])).toMatchObject({ reason: 'no-data' });
    expect(inferEvent(T0, [])).toMatchObject({ reason: 'no-data' });
    expect(inferEvent(T0, null)).toMatchObject({ reason: 'no-data' });
    expect(inferEvent(NaN, [timed('a', T0, T0 + HOUR)])).toMatchObject({ reason: 'no-data' });
  });

  it('invalid windows are dropped, not matched', () => {
    expect(
      inferEvent(T0, [{ eventId: 'x', startMs: NaN, endMs: NaN, title: 'x' }])
    ).toMatchObject({ reason: 'no-data' });
  });
});

describe('eventWindowsFromApi', () => {
  it('parses ISO bounds, drops unparseable rows, carries all_day', () => {
    const windows = eventWindowsFromApi([
      { id: 'a', title: 'Meet', starts_at: '2026-08-29T14:00:00Z', ends_at: '2026-08-29T16:00:00Z' },
      { id: 'bad', title: 'x', starts_at: 'nope', ends_at: 'nope' },
      { id: 'd', title: 'Camp', starts_at: '2026-08-29T00:00:00Z', ends_at: '2026-08-30T00:00:00Z', all_day: true },
    ]);
    expect(windows.map(w => w.eventId)).toEqual(['a', 'd']);
    expect(windows[1].allDay).toBe(true);
  });
});
