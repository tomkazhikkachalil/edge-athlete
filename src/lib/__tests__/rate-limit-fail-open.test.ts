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
