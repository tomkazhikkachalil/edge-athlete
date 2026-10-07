import { describe, it, expect } from 'vitest';
import { abandonFinalizeFields, isAbandonedSession, ABANDON_AFTER_MS } from '../workouts/status';

// Drafts round PR 5 (Oct 2026): the 6 h lazy auto-end is gone — nothing
// finishes at read time. The daily sweep finishes an ACTIVE session untouched
// for 7 days as it stands (a draft, never a post).

const NOW = 1_800_000_000_000;

describe('isAbandonedSession', () => {
  it('an active session untouched past the window (boundary)', () => {
    expect(isAbandonedSession({ status: 'active', lastActivityAt: new Date(NOW - ABANDON_AFTER_MS - 1000).toISOString(), now: NOW })).toBe(true);
    expect(isAbandonedSession({ status: 'active', lastActivityAt: new Date(NOW - ABANDON_AFTER_MS + 1000).toISOString(), now: NOW })).toBe(false);
    expect(ABANDON_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it('six quiet hours are NOT abandoned any more', () => {
    expect(isAbandonedSession({ status: 'active', lastActivityAt: new Date(NOW - 7 * 60 * 60 * 1000).toISOString(), now: NOW })).toBe(false);
  });
  it('completed, a missing clock and garbage never fire', () => {
    expect(isAbandonedSession({ status: 'completed', lastActivityAt: new Date(NOW - 30 * ABANDON_AFTER_MS).toISOString(), now: NOW })).toBe(false);
    expect(isAbandonedSession({ status: 'active', lastActivityAt: null, now: NOW })).toBe(false);
    expect(isAbandonedSession({ status: 'active', lastActivityAt: 'not-a-date', now: NOW })).toBe(false);
  });
});

describe('abandonFinalizeFields', () => {
  it('ends at last activity with a truthful duration — and nothing about sharing', () => {
    const startedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const lastActivityAt = new Date(NOW - 60 * 60 * 1000).toISOString();
    const fields = abandonFinalizeFields({ startedAt, lastActivityAt });
    expect(fields).toEqual({ status: 'completed', ended_at: lastActivityAt, duration_seconds: 3600 });
    expect('share_decided_at' in fields).toBe(false);
  });
  it('never produces a negative duration', () => {
    const startedAt = new Date(NOW).toISOString();
    const lastActivityAt = new Date(NOW - 1000).toISOString(); // clock skew
    expect(abandonFinalizeFields({ startedAt, lastActivityAt }).duration_seconds).toBe(0);
  });
});
