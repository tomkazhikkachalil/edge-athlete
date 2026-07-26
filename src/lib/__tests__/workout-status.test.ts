import { describe, it, expect } from 'vitest';
import { effectiveSessionStatus, staleFinalizeFields, AUTO_END_AFTER_MS } from '../workouts/status';

const NOW = 1_800_000_000_000;

describe('effectiveSessionStatus', () => {
  it('completed stays completed', () => {
    expect(
      effectiveSessionStatus({ status: 'completed', lastActivityAt: new Date(NOW).toISOString(), now: NOW })
    ).toBe('completed');
  });

  it('active within the idle window stays active (boundary)', () => {
    const justUnder = new Date(NOW - AUTO_END_AFTER_MS + 1000).toISOString();
    expect(effectiveSessionStatus({ status: 'active', lastActivityAt: justUnder, now: NOW })).toBe('active');
  });

  it('active past the idle window reads as completed (boundary)', () => {
    const justOver = new Date(NOW - AUTO_END_AFTER_MS - 1000).toISOString();
    expect(effectiveSessionStatus({ status: 'active', lastActivityAt: justOver, now: NOW })).toBe('completed');
  });

  it('null lastActivityAt stays active (brand-new session)', () => {
    expect(effectiveSessionStatus({ status: 'active', lastActivityAt: null, now: NOW })).toBe('active');
  });
});

describe('staleFinalizeFields', () => {
  it('ends at last activity with a truthful duration', () => {
    const startedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const lastActivityAt = new Date(NOW - 60 * 60 * 1000).toISOString();
    const fields = staleFinalizeFields({ startedAt, lastActivityAt });
    expect(fields.status).toBe('completed');
    expect(fields.ended_at).toBe(lastActivityAt);
    expect(fields.duration_seconds).toBe(3600);
  });

  it('never produces a negative duration', () => {
    const startedAt = new Date(NOW).toISOString();
    const lastActivityAt = new Date(NOW - 1000).toISOString(); // clock skew
    const fields = staleFinalizeFields({ startedAt, lastActivityAt });
    expect(fields.duration_seconds).toBe(0);
  });
});
