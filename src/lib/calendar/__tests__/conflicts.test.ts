import { describe, it, expect } from 'vitest';
import { conflictDayKeys, findConflicts, type ConflictEvent } from '../conflicts';

// Timed events built in viewer-local time so the expected dayKeys are stable
// whatever TZ the test runner uses.
const local = (y: number, mo: number, d: number, h: number, min = 0) =>
  new Date(y, mo - 1, d, h, min).toISOString();

const timed = (id: string, startsAt: string, endsAt: string, childIds = ['kid-a']): ConflictEvent => ({
  id,
  title: id,
  starts_at: startsAt,
  ends_at: endsAt,
  all_day: false,
  timezone: 'UTC',
  childIds,
});

describe('findConflicts', () => {
  it('overlapping timed events conflict, with the overlap day keyed viewer-local', () => {
    const pairs = findConflicts([
      timed('practice', local(2026, 8, 29, 14), local(2026, 8, 29, 16)),
      timed('match', local(2026, 8, 29, 15), local(2026, 8, 29, 17), ['kid-b']),
    ]);
    expect(pairs).toEqual([{ ids: ['practice', 'match'], dayKeys: ['2026-08-29'] }]);
  });

  it('touching endpoints are back-to-back, not a conflict', () => {
    const pairs = findConflicts([
      timed('first', local(2026, 8, 29, 14), local(2026, 8, 29, 15)),
      timed('second', local(2026, 8, 29, 15), local(2026, 8, 29, 16)),
    ]);
    expect(pairs).toEqual([]);
  });

  it('disjoint days never conflict', () => {
    const pairs = findConflicts([
      timed('sat', local(2026, 8, 29, 14), local(2026, 8, 29, 15)),
      timed('sun', local(2026, 8, 30, 14), local(2026, 8, 30, 15)),
    ]);
    expect(pairs).toEqual([]);
  });

  it('shared events are pre-deduped by the caller: one event, two childIds, no self-pair', () => {
    const pairs = findConflicts([
      timed('shared', local(2026, 8, 29, 14), local(2026, 8, 29, 16), ['kid-a', 'kid-b']),
    ]);
    expect(pairs).toEqual([]);
  });

  it('all-day vs timed on the same day conflicts (day-level)', () => {
    const dayKeys = (() => {
      // The all-day event anchored to the viewer-local day so the day labels
      // line up in any test TZ.
      const dayStart = new Date(2026, 7, 29);
      const dayEnd = new Date(2026, 7, 30);
      const allDay: ConflictEvent = {
        id: 'tournament',
        title: 'tournament',
        starts_at: dayStart.toISOString(),
        ends_at: dayEnd.toISOString(),
        all_day: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        childIds: ['kid-a'],
      };
      return findConflicts([allDay, timed('practice', local(2026, 8, 29, 15), local(2026, 8, 29, 16), ['kid-b'])]);
    })();
    expect(dayKeys).toEqual([{ ids: ['tournament', 'practice'], dayKeys: ['2026-08-29'] }]);
  });

  it('two all-day events intersect on shared event-zone day labels', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const allDay = (id: string, from: Date, to: Date): ConflictEvent => ({
      id, title: id,
      starts_at: from.toISOString(), ends_at: to.toISOString(),
      all_day: true, timezone: zone, childIds: ['kid-a'],
    });
    const pairs = findConflicts([
      allDay('camp', new Date(2026, 7, 28), new Date(2026, 7, 31)), // 28,29,30
      allDay('regatta', new Date(2026, 7, 30), new Date(2026, 7, 31)), // 30
    ]);
    expect(pairs).toEqual([{ ids: ['camp', 'regatta'], dayKeys: ['2026-08-30'] }]);
  });

  it('a multi-day timed overlap reports every touched local day', () => {
    const pairs = findConflicts([
      timed('trip', local(2026, 8, 29, 20), local(2026, 8, 31, 10)),
      timed('visit', local(2026, 8, 30, 9), local(2026, 8, 30, 23), ['kid-b']),
    ]);
    expect(pairs).toEqual([{ ids: ['trip', 'visit'], dayKeys: ['2026-08-30'] }]);
  });

  it('ordering is deterministic: pairs follow input order', () => {
    const a = timed('a', local(2026, 8, 29, 14), local(2026, 8, 29, 16));
    const b = timed('b', local(2026, 8, 29, 15), local(2026, 8, 29, 17));
    const c = timed('c', local(2026, 8, 29, 15, 30), local(2026, 8, 29, 18));
    expect(findConflicts([a, b, c]).map(p => p.ids)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
});

describe('conflictDayKeys', () => {
  it('unions day keys across pairs', () => {
    expect(
      [...conflictDayKeys([
        { ids: ['a', 'b'], dayKeys: ['2026-08-29'] },
        { ids: ['a', 'c'], dayKeys: ['2026-08-29', '2026-08-30'] },
      ])].sort()
    ).toEqual(['2026-08-29', '2026-08-30']);
  });
});
