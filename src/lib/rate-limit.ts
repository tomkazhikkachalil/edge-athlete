// Supabase-backed rate limiting (migration 094). The previous in-memory Map
// limiter was per-lambda — on Vercel that meant limit × live instances,
// reset on every cold start — and guarded 3 routes. This one is shared
// across instances: one atomic rate_limit_hit() RPC per check — or ONE
// rate_limit_hit_many() for a write's buckets together (286).
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
  type RateLimitRule, routeLabel,
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

/** One log line per action per minute: how many requests went over its
 *  budget since the last line (maintenance pass, Oct 10 2026 — a 429 used to
 *  leave no trace). Never the identifier: the action and the count are what
 *  tuning needs. Pure over the module map, exported for the test. */
const LIMIT_LOG_MS = 60_000;
const limitLog = new Map<string, { at: number; count: number }>();

export function logLimitHit(action: string, outcome: 'blocked' | 'would-block', now: number): boolean {
  const key = `${action}:${outcome}`;
  const entry = limitLog.get(key) ?? { at: 0, count: 0 };
  entry.count += 1;
  limitLog.set(key, entry);
  if (now - entry.at < LIMIT_LOG_MS) return false;
  console.warn(`[RATE-LIMIT] ${outcome} "${action}": ${entry.count} over budget since the last line`);
  entry.at = now;
  entry.count = 0;
  return true;
}

/** The durable record (Oct 22 2026, Tom: "record every would-block and block
 *  in Sentry… show me the count by account and action"): one Sentry warning
 *  per account + route + outcome per ten minutes per instance, carrying the
 *  hits since the last one. Vercel keeps the console line about an hour, so
 *  the line alone could never answer the question. Pure over the module map,
 *  exported for the test. */
const LIMIT_REPORT_MS = 10 * 60_000;
const limitReports = new Map<string, { at: number; count: number }>();

export function shouldReportLimit(key: string, now: number): { report: boolean; count: number } {
  const entry = limitReports.get(key) ?? { at: 0, count: 0 };
  entry.count += 1;
  limitReports.set(key, entry);
  if (now - entry.at < LIMIT_REPORT_MS) return { report: false, count: entry.count };
  const count = entry.count;
  entry.at = now;
  entry.count = 0;
  return { report: true, count };
}

function recordLimitHit(action: string, outcome: 'blocked' | 'would-block', account: string | null, route: string, now: number): void {
  const { report, count } = shouldReportLimit(`${action}:${outcome}:${account ?? 'ip'}:${route}`, now);
  if (!report) return;
  Sentry.captureMessage(`[RATE-LIMIT] ${outcome} "${action}"`, {
    level: 'warning',
    // The account is the pseudonymous user id — never an e-mail or a name.
    tags: { area: 'rate-limit', action, outcome, account: account ?? 'ip', route },
    extra: { hits_since_last_report: count },
  });
}

/** One request's limiter answers (migration 286, the leftovers program PR 1 —
 *  one hit per write): `requireAuth(request, { limit })` checks `write-general`
 *  and the route's own bucket(s) in ONE `rate_limit_hit_many` call and leaves
 *  each bucket's verdict here; the route's `enforceRateLimit(request, bucket)`
 *  then finds it and spends no round trip. A fail-open is memoised too (null),
 *  so a database without 286 costs one failed call, not two. */
const limitMemo = new WeakMap<NextRequest, Map<string, NextResponse | null>>();
const memoKey = (action: string, extraKey?: string) => `${action}:${extraKey ?? ''}`;

function identifierFor(request: NextRequest, action: RateLimitAction, rule: RateLimitRule, userId?: string): string {
  if (rule.keyBy === 'user') {
    if (userId) return userId;
    // Programmer error — a user-keyed action called without a user. Fall
    // back to IP so the request is still limited rather than unlimited.
    console.error(`[RATE-LIMIT] action "${action}" is user-keyed but no userId was passed`);
    return getClientIp(request) ?? 'unknown';
  }
  return getClientIp(request) ?? 'unknown';
}

/** The verdict for one bucket's row — allowed: null; over the budget: always
 *  on the record (the console line, throttled per action; the Sentry record
 *  per account + route) — and a SHADOW bucket stops there: it never refuses
 *  anyone. Otherwise the ready 429. */
function judge(request: NextRequest, action: RateLimitAction, rule: RateLimitRule, identifier: string, row: { allowed: boolean; retry_after_seconds: number }): NextResponse | null {
  if (row.allowed) return null;
  const outcome = rule.shadow ? 'would-block' : 'blocked';
  const now = Date.now();
  logLimitHit(action, outcome, now);
  recordLimitHit(action, outcome, rule.keyBy === 'user' ? identifier : null, routeLabel(request.method, request.nextUrl.pathname), now);
  if (rule.shadow) return null;
  return NextResponse.json(
    { error: rule.message ?? 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: { 'Retry-After': String(clampRetryAfter(row.retry_after_seconds)) },
    }
  );
}

/** Fail-open: log every time, Sentry once per FAIL_OPEN_REPORT_MS per instance, let the request through. */
function failOpen(action: string, error: unknown): null {
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

/**
 * Check-and-consume one hit against the named action's budget.
 * Returns a ready 429 NextResponse when over the limit, null otherwise.
 * When requireAuth already checked this bucket for this request (286), the
 * memoised verdict is returned and no round trip is spent.
 */
export async function enforceRateLimit(
  request: NextRequest,
  action: RateLimitAction,
  opts?: { userId?: string; extraKey?: string }
): Promise<NextResponse | null> {
  const remembered = limitMemo.get(request)?.get(memoKey(action, opts?.extraKey));
  if (remembered !== undefined) return remembered;

  // Widen to the interface: `as const` narrows away optional `message` on
  // entries that don't declare it.
  const rule: RateLimitRule = RATE_LIMITS[action];
  const identifier = identifierFor(request, action, rule, opts?.userId);
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
    return judge(request, action, rule, identifier, data as { allowed: boolean; retry_after_seconds: number });
  } catch (error) {
    return failOpen(action, error);
  }
}

/**
 * Several buckets in ONE round trip (286): `rate_limit_hit_many` walks the
 * keys in order through 094's `rate_limit_hit`, so each bucket behaves
 * exactly as it does alone. Every bucket's verdict is memoised for this
 * request; the first refusal (a ready 429) is returned, null when all pass.
 * requireAuth sends `['write-general', ...the route's buckets]`.
 */
export async function enforceRateLimitMany(
  request: NextRequest,
  actions: readonly RateLimitAction[],
  opts?: { userId?: string }
): Promise<NextResponse | null> {
  const items = actions.map(action => {
    const rule: RateLimitRule = RATE_LIMITS[action];
    const identifier = identifierFor(request, action, rule, opts?.userId);
    return { action, rule, identifier, key: buildRateLimitKey(action, identifier) };
  });
  let memo = limitMemo.get(request);
  if (!memo) { memo = new Map(); limitMemo.set(request, memo); }

  try {
    const { data, error } = await getSupabaseAdmin().rpc('rate_limit_hit_many', {
      p_keys: items.map(i => i.key),
      p_max: items.map(i => i.rule.max),
      p_window_seconds: items.map(i => i.rule.windowSeconds),
    });
    if (error) throw error;
    const rows = new Map(((data ?? []) as Array<{ key: string; allowed: boolean; retry_after_seconds: number }>).map(r => [r.key, r]));
    let first: NextResponse | null = null;
    for (const it of items) {
      const row = rows.get(it.key);
      // A key the function did not answer fails open for that bucket alone.
      const verdict = row ? judge(request, it.action, it.rule, it.identifier, row) : null;
      memo.set(memoKey(it.action), verdict);
      if (verdict && !first) first = verdict;
    }
    return first;
  } catch (error) {
    for (const it of items) memo.set(memoKey(it.action), null);
    return failOpen(actions.join('+'), error);
  }
}
