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
// request proceeds and we log + Sentry once per cold start — availability
// over strictness, and it makes the migration's deploy order flexible.
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

let failOpenReported = false;

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
    if (!failOpenReported) {
      failOpenReported = true;
      Sentry.captureMessage('rate-limit: fail-open (rate_limit_hit RPC unavailable?)', {
        level: 'warning',
        tags: { area: 'rate-limit' },
        extra: { action },
      });
    }
    return null;
  }
}
