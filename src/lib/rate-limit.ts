// Supabase-backed rate limiting (migration 094). The previous in-memory Map
// limiter was per-lambda — on Vercel that meant limit × live instances,
// reset on every cold start — and guarded 3 routes. This one is shared
// across instances: one atomic rate_limit_hit() RPC per check.
//
// Usage in a route (mirrors parseBody's return-a-ready-response convention):
//
//   const limited = await enforceRateLimit(request, 'post-create', { userId: user.id });
//   if (limited) return limited;
//
// Fail-open on purpose: if the RPC errors (e.g. 094 not applied yet), the
// request proceeds and we log every time + Sentry at most once per
// FAIL_OPEN_REPORT_MS per instance, carrying how many requests passed
// unlimited since the last report — availability over strictness, and it
// makes the migration's deploy order flexible. (It was once per cold start:
// a warm instance could run open for hours after its one warning.)
// Limits/actions live in ./rate-limit-core.ts (pure, unit-tested).

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/auth-server';
import {
  RATE_LIMITS,
  buildRateLimitKey,
  clampRetryAfter,
  firstForwardedIp,
  type RateLimitAction,
  type RateLimitRule,
} from '@/lib/rate-limit-core';

export * from '@/lib/rate-limit-core';

/**
 * Client IP as Vercel's proxy reports it (first x-forwarded-for hop), or
 * null when absent (e.g. localhost dev). Nullable on purpose: audit-trail
 * call sites store null, the limiter substitutes 'unknown'.
 */
export function getClientIp(request: NextRequest): string | null {
  return firstForwardedIp(request.headers.get('x-forwarded-for'));
}

/** Sentry cadence for the fail-open path (Round 1 PR 7): one report per window, per instance. */
export const FAIL_OPEN_REPORT_MS = 10 * 60 * 1000;
let failOpenLastReportedAt = 0;
let failOpenSinceReport = 0;

/**
 * Whether a fail-open at `now` should reach Sentry, and how many were
 * swallowed since the last report (that count included). Pure over the
 * two module counters, exported for the test.
 */
export function shouldReportFailOpen(now: number): { report: boolean; count: number } {
  failOpenSinceReport += 1;
  if (now - failOpenLastReportedAt < FAIL_OPEN_REPORT_MS) return { report: false, count: failOpenSinceReport };
  const count = failOpenSinceReport;
  failOpenLastReportedAt = now;
  failOpenSinceReport = 0;
  return { report: true, count };
}

/**
 * Check-and-consume one hit against the named action's budget.
 * Returns a ready 429 NextResponse when over the limit, null otherwise.
 */
export async function enforceRateLimit(
  request: NextRequest,
  action: RateLimitAction,
  opts?: { userId?: string; extraKey?: string }
): Promise<NextResponse | null> {
  // Widen to the interface: `as const` narrows away optional `message` on
  // entries that don't declare it.
  const rule: RateLimitRule = RATE_LIMITS[action];

  let identifier: string;
  if (rule.keyBy === 'user') {
    if (opts?.userId) {
      identifier = opts.userId;
    } else {
      // Programmer error — a user-keyed action called without a user. Fall
      // back to IP so the request is still limited rather than unlimited.
      console.error(`[RATE-LIMIT] action "${action}" is user-keyed but no userId was passed`);
      identifier = getClientIp(request) ?? 'unknown';
    }
  } else {
    identifier = getClientIp(request) ?? 'unknown';
  }

  const key = buildRateLimitKey(action, identifier, opts?.extraKey);

  try {
    const { data, error } = await getSupabaseAdmin()
      .rpc('rate_limit_hit', {
        p_key: key,
        p_max: rule.max,
        p_window_seconds: rule.windowSeconds,
      })
      .single();

    if (error) throw error;

    const row = data as { allowed: boolean; retry_after_seconds: number };
    if (row.allowed) return null;

    return NextResponse.json(
      { error: rule.message ?? 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(clampRetryAfter(row.retry_after_seconds)) },
      }
    );
  } catch (error) {
    console.error(`[RATE-LIMIT] fail-open on "${action}":`, error);
    const { report, count } = shouldReportFailOpen(Date.now());
    if (report) {
      Sentry.captureMessage('rate-limit: fail-open (rate_limit_hit RPC unavailable?)', {
        level: 'warning',
        tags: { area: 'rate-limit' },
        extra: { action, unlimited_since_last_report: count, error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error) },
      });
    }
    return null;
  }
}
