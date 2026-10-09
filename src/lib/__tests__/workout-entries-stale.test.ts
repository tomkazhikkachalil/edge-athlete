import { describe, expect, it } from 'vitest';
import { entriesWriteIsStale, entriesWriteStampsActivity } from '../workouts/entries-stale';

const T = Date.parse('2026-10-09T12:00:00.000Z');

describe('entries stale-write rule — live sessions guarded, completed ones editable', () => {
  it('drops an out-of-order snapshot on a live session', () => {
    expect(entriesWriteIsStale({ status: 'active', lastActivityAt: new Date(T).toISOString(), savedAt: T - 1 })).toBe(true);
    expect(entriesWriteIsStale({ status: 'active', lastActivityAt: new Date(T).toISOString(), savedAt: T })).toBe(true);
    expect(entriesWriteIsStale({ status: 'active', lastActivityAt: new Date(T).toISOString(), savedAt: T + 1 })).toBe(false);
    expect(entriesWriteIsStale({ status: 'active', lastActivityAt: null, savedAt: 1 })).toBe(false);
  });

  it('never drops an edit on a completed session — its last_activity_at is the END time, which can be in the future', () => {
    const futureEnd = new Date(T + 30 * 60_000).toISOString();
    expect(entriesWriteIsStale({ status: 'completed', lastActivityAt: futureEnd, savedAt: T })).toBe(false);
    expect(entriesWriteIsStale({ status: 'completed', lastActivityAt: new Date(T).toISOString(), savedAt: T - 60_000 })).toBe(false);
  });

  it('stamps last_activity_at only while the session is live', () => {
    expect(entriesWriteStampsActivity('active')).toBe(true);
    expect(entriesWriteStampsActivity('completed')).toBe(false);
  });
});
