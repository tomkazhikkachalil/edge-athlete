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
import { readFileSync } from 'fs';
import { join } from 'path';
import { logLimitHit, RATE_LIMITS, routeLabel, shouldReportLimit } from '../rate-limit';
import { RETRY_AFTER_CAP_MS, SLOW_DOWN_MESSAGE, retryAfterMs } from '../rate-limit-retry';

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

  it('the general write bucket is a generous, per-account SHADOW — with the plain 429 it will send once real', () => {
    const rule = RATE_LIMITS['write-general'];
    expect(rule.shadow).toBe(true); // flips in its own one-line PR once Sentry shows a few days of nobody near it (Oct 22 2026)
    expect(rule.keyBy).toBe('user');
    expect(rule.max / rule.windowSeconds).toBeGreaterThanOrEqual(2);
    expect(rule.message).toBe(SLOW_DOWN_MESSAGE);
  });

  it('the upload bucket allows a photo every 15 s for an hour (raised before the write bucket goes real)', () => {
    expect(RATE_LIMITS.upload).toMatchObject({ max: 240, windowSeconds: 3600, keyBy: 'user' });
  });
});

// Oct 22 2026 (Tom): the check runs inline, every would-block or block is
// recorded in Sentry by account and route, and a 429 never loses a workout
// or an activity.
describe('the write limit, inline and on the record', () => {
  it('a route label collapses ids so Sentry groups by route', () => {
    expect(routeLabel('put', '/api/workouts/4f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90/entries')).toBe('PUT /api/workouts/[id]/entries');
    expect(routeLabel('POST', '/api/posts/123/like')).toBe('POST /api/posts/[id]/like');
    expect(routeLabel('', '/api/activities')).toBe('GET /api/activities');
  });

  it('reports once per key per ten minutes, carrying the hits since the last report', () => {
    const t0 = 9_000_000;
    expect(shouldReportLimit('write-general:would-block:u1:PUT /api/x', t0)).toEqual({ report: true, count: 1 });
    expect(shouldReportLimit('write-general:would-block:u1:PUT /api/x', t0 + 1_000).report).toBe(false);
    expect(shouldReportLimit('write-general:would-block:u1:PUT /api/x', t0 + 2_000).report).toBe(false);
    expect(shouldReportLimit('write-general:would-block:u2:PUT /api/x', t0 + 2_000)).toEqual({ report: true, count: 1 }); // another account: its own line
    expect(shouldReportLimit('write-general:would-block:u1:PUT /api/x', t0 + 10 * 60_000)).toEqual({ report: true, count: 3 }); // the two held back plus this one
  });

  it('requireAuth runs the check before the handler and throws the 429; the limiter records to Sentry by account and route', () => {
    const auth = readFileSync(join(__dirname, '..', 'auth-server.ts'), 'utf8');
    expect(auth).toContain('await enforceWrite(request, user.id, opts.limit);');
    // 286: the route's bucket(s) ride write-general's round trip; a route without one keeps the single hit
    expect(auth).toContain("? await enforceRateLimitMany(request, ['write-general', ...extra], { userId })\n    : await enforceRateLimit(request, 'write-general', { userId });\n  if (refused) throw refused;");
    expect(auth).not.toContain('after(async');
    const limiter = readFileSync(join(__dirname, '..', 'rate-limit.ts'), 'utf8');
    expect(limiter).toContain('Sentry.captureMessage(`[RATE-LIMIT] ${outcome} "${action}"`');
    expect(limiter).toContain("tags: { area: 'rate-limit', action, outcome, account: account ?? 'ip', route }");
    expect(limiter).toContain("recordLimitHit(action, outcome, rule.keyBy === 'user' ? identifier : null, routeLabel(request.method, request.nextUrl.pathname), now);");
  });

  it('a 429 never loses a workout or an activity: both re-send after Retry-After and say so', () => {
    const editor = readFileSync(join(__dirname, '..', '..', 'components', 'workouts', 'WorkoutEditorScreen.tsx'), 'utf8');
    expect(editor).toContain('if (response.status === 429 && !retryTimerRef.current) {');
    expect(editor).toContain("showError('Slow down', SLOW_DOWN_MESSAGE);");
    expect(editor).toContain("}, retryAfterMs(response.headers.get('Retry-After')));");
    const recorder = readFileSync(join(__dirname, '..', '..', 'components', 'activities', 'record', 'RecordActivityScreen.tsx'), 'utf8');
    expect(recorder).toContain('if (res.status === 429) {');
    expect(recorder).toContain('setSaveError(`Slow down — retrying in ${Math.ceil(wait / 1000)} s…`);');
    expect(recorder).toContain('res = await post();');
    // The recording is cleared from the device only after the row exists.
    expect(recorder.indexOf('await engine.clear();')).toBeGreaterThan(recorder.indexOf("if (!res.ok || !json.id) throw new Error"));
  });

  it('Retry-After is read in seconds, capped, and defaulted', () => {
    expect(retryAfterMs('2')).toBe(2_000);
    expect(retryAfterMs('90')).toBe(RETRY_AFTER_CAP_MS);
    expect(retryAfterMs(null)).toBe(2_000);
    expect(retryAfterMs('soon')).toBe(2_000);
    expect(retryAfterMs('0')).toBe(2_000);
    expect(retryAfterMs('5', 3_000)).toBe(3_000);
  });
});
