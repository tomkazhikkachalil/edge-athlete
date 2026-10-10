import { describe, it, expect } from 'vitest';
import { FAIL_OPEN_REPORT_MS, shouldReportFailOpen } from '../rate-limit';

// Round 1 PR 7: the limiter's fail-open used to reach Sentry once per cold
// start — a warm instance could run unlimited for hours after its one
// warning. Now: one report per window, carrying the count swallowed since.

describe('rate-limit fail-open reporting cadence', () => {
  it('reports the first, swallows inside the window, reports again after it with the count', () => {
    const t0 = 1_000_000;
    expect(shouldReportFailOpen(t0)).toEqual({ report: true, count: 1 });
    expect(shouldReportFailOpen(t0 + 1_000).report).toBe(false);
    expect(shouldReportFailOpen(t0 + FAIL_OPEN_REPORT_MS - 1).report).toBe(false);
    expect(shouldReportFailOpen(t0 + FAIL_OPEN_REPORT_MS)).toEqual({ report: true, count: 3 });
    expect(shouldReportFailOpen(t0 + FAIL_OPEN_REPORT_MS + 1).report).toBe(false);
  });
});

// Maintenance pass (Oct 10 2026): an over-budget request leaves a trace — one
// line per action per minute with the count, never the identifier — and a
// SHADOW bucket only ever logs.
import { vi } from 'vitest';
import { logLimitHit, RATE_LIMITS } from '../rate-limit';

describe('rate-limit hit logging and shadow buckets', () => {
  it('logs the first hit, counts the rest inside the minute, logs again after it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = 5_000_000;
    expect(logLimitHit('like', 'blocked', t0)).toBe(true);
    expect(logLimitHit('like', 'blocked', t0 + 1_000)).toBe(false);
    expect(logLimitHit('like', 'would-block', t0 + 1_000)).toBe(true); // its own line
    expect(logLimitHit('like', 'blocked', t0 + 60_000)).toBe(true);
    expect(warn.mock.calls.at(-1)?.[0]).toBe('[RATE-LIMIT] blocked "like": 2 over budget since the last line');
    warn.mockRestore();
  });

  it('the general write bucket is a generous, per-account SHADOW', () => {
    const rule = RATE_LIMITS['write-general'];
    expect(rule.shadow).toBe(true);
    expect(rule.keyBy).toBe('user');
    expect(rule.max / rule.windowSeconds).toBeGreaterThanOrEqual(2);
  });
});
