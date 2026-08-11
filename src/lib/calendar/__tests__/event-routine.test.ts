import { describe, it, expect } from 'vitest';
import {
  buildRoutineSnapshot,
  parseRoutineSnapshot,
  pickRoutineSource,
  canStartEventWorkout,
} from '../event-routine';
import type { ServerRoutineRow } from '@/lib/workouts/routines';

const serverRow: ServerRoutineRow = {
  id: 'r1',
  name: 'Push Day',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-11T00:00:00.000Z',
  exercises: [
    { name: 'Rows', exercise_key: null, category: 'strength', position: 1, notes: null, target_sets: 3 },
    { name: 'Bench Press', exercise_key: 'bench_press', category: 'strength', position: 0, notes: 'pause', target_sets: 4 },
  ],
};

const validSnapshot = {
  name: 'Old Push Day',
  exercises: [
    { name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength' as const, notes: null, targetSets: 3 },
  ],
};

describe('buildRoutineSnapshot', () => {
  it('sorts by position and maps snake_case', () => {
    const snapshot = buildRoutineSnapshot(serverRow);
    expect(snapshot.name).toBe('Push Day');
    expect(snapshot.exercises.map(e => e.name)).toEqual(['Bench Press', 'Rows']);
    expect(snapshot.exercises[0]).toEqual({
      name: 'Bench Press', exerciseKey: 'bench_press', category: 'strength',
      notes: 'pause', targetSets: 4,
    });
  });

  it('tolerates a missing exercises embed', () => {
    expect(buildRoutineSnapshot({ ...serverRow, exercises: undefined }).exercises).toEqual([]);
  });

  it('round-trips through parseRoutineSnapshot', () => {
    expect(parseRoutineSnapshot(buildRoutineSnapshot(serverRow))).not.toBeNull();
  });
});

describe('parseRoutineSnapshot', () => {
  it('accepts the written shape', () => {
    const parsed = parseRoutineSnapshot(validSnapshot);
    expect(parsed?.name).toBe('Old Push Day');
    expect(parsed?.exercises).toHaveLength(1);
  });

  it('rejects malformed shapes', () => {
    expect(parseRoutineSnapshot(null)).toBeNull();
    expect(parseRoutineSnapshot('x')).toBeNull();
    expect(parseRoutineSnapshot({})).toBeNull();
    expect(parseRoutineSnapshot({ name: 'X', exercises: [] })).toBeNull();
    expect(parseRoutineSnapshot({ name: 'X', exercises: [{ name: 'A' }] })).toBeNull();
    expect(
      parseRoutineSnapshot({
        name: 'X',
        exercises: [{ ...validSnapshot.exercises[0], targetSets: 99 }],
      })
    ).toBeNull();
  });
});

describe('pickRoutineSource', () => {
  const live = { name: 'Live', exercises: validSnapshot.exercises };

  it('live wins over snapshot', () => {
    const picked = pickRoutineSource(live, validSnapshot);
    expect(picked?.source).toBe('live');
    expect(picked?.name).toBe('Live');
  });

  it('falls back to a valid snapshot', () => {
    const picked = pickRoutineSource(null, validSnapshot);
    expect(picked?.source).toBe('snapshot');
    expect(picked?.name).toBe('Old Push Day');
  });

  it('returns null when neither resolves', () => {
    expect(pickRoutineSource(null, null)).toBeNull();
    expect(pickRoutineSource(null, { bad: true })).toBeNull();
  });
});

describe('canStartEventWorkout', () => {
  // Event: Aug 12 2026, 18:00–19:00 in Auckland (UTC+12 in August)
  const base = {
    status: 'active' as const,
    starts_at: '2026-08-12T06:00:00.000Z',
    ends_at: '2026-08-12T07:00:00.000Z',
    timezone: 'Pacific/Auckland',
    isOrganizer: false,
    myStatus: 'accepted' as string | null,
  };
  const AUCKLAND_AUG12_NOON = Date.parse('2026-08-12T00:00:00.000Z'); // = Aug 12 12:00 NZST

  it('allows an accepted guest on the event day (event timezone)', () => {
    expect(canStartEventWorkout({ ...base, now: AUCKLAND_AUG12_NOON })).toBe(true);
  });

  it('is day-gated in the EVENT zone, not the viewer clock zone', () => {
    // Aug 11 23:00 UTC = Aug 12 11:00 in Auckland → allowed even though UTC says Aug 11
    expect(canStartEventWorkout({ ...base, now: Date.parse('2026-08-11T23:00:00.000Z') })).toBe(true);
    // Aug 11 10:00 UTC = Aug 11 22:00 Auckland → still the day before
    expect(canStartEventWorkout({ ...base, now: Date.parse('2026-08-11T10:00:00.000Z') })).toBe(false);
  });

  it('rejects the day after', () => {
    expect(canStartEventWorkout({ ...base, now: Date.parse('2026-08-13T06:00:00.000Z') })).toBe(false);
  });

  it('treats the exclusive all-day end as the same day', () => {
    // All-day Aug 12 in UTC: [Aug 12 00:00, Aug 13 00:00)
    const allDay = {
      ...base,
      timezone: 'UTC',
      starts_at: '2026-08-12T00:00:00.000Z',
      ends_at: '2026-08-13T00:00:00.000Z',
    };
    expect(canStartEventWorkout({ ...allDay, now: Date.parse('2026-08-12T23:59:00.000Z') })).toBe(true);
    expect(canStartEventWorkout({ ...allDay, now: Date.parse('2026-08-13T00:01:00.000Z') })).toBe(false);
  });

  it('spans multi-day events', () => {
    const multi = { ...base, timezone: 'UTC', starts_at: '2026-08-10T09:00:00.000Z', ends_at: '2026-08-12T17:00:00.000Z' };
    expect(canStartEventWorkout({ ...multi, now: Date.parse('2026-08-11T01:00:00.000Z') })).toBe(true);
  });

  it('blocks declined guests but not the organizer', () => {
    expect(canStartEventWorkout({ ...base, myStatus: 'declined', now: AUCKLAND_AUG12_NOON })).toBe(false);
    expect(
      canStartEventWorkout({ ...base, myStatus: 'declined', isOrganizer: true, now: AUCKLAND_AUG12_NOON })
    ).toBe(true);
  });

  it('blocks cancelled events and bad timezones', () => {
    expect(canStartEventWorkout({ ...base, status: 'cancelled', now: AUCKLAND_AUG12_NOON })).toBe(false);
    expect(canStartEventWorkout({ ...base, timezone: 'Not/AZone', now: AUCKLAND_AUG12_NOON })).toBe(false);
  });
});
