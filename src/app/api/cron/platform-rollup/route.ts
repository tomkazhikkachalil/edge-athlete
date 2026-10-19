import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runPlatformRollup } from '@/lib/platform-stats/rollup-server';
import { DAY_RE, recomputableDay, yesterdayUTC } from '@/lib/platform-stats/metrics';
import { recordJobRun } from '@/lib/platform-jobs/record';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 300;

/**
 * POST /api/cron/platform-rollup — the nightly rollup (migration 267; H1).
 * Scheduled by pg_cron at 00:10 UTC on production (268); answers 202 at once
 * and does the work through `waitUntil` (the media-jobs shape, so pg_net
 * never waits). Body `{ day?: 'YYYY-MM-DD' }` (default yesterday UTC) — one
 * day, every group, a 240 s budget; the result lands in platform_jobs and a
 * failed or skipped group is a Sentry message. Without CRON_SECRET: 401.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { day?: unknown };
  const day = typeof body.day === 'string' && DAY_RE.test(body.day) ? body.day : yesterdayUTC();
  if (!recomputableDay(day)) return NextResponse.json({ error: 'day must be YYYY-MM-DD, not in the future, within 400 days' }, { status: 400 });
  const admin = getSupabaseAdmin();
  waitUntil(
    recordJobRun(admin, 'platform-rollup', () => runPlatformRollup(admin, day, { budgetMs: 240_000 }), { ok: r => r.ok }).then(
      r => {
        if (!r.supported) return;
        if (!r.ok) Sentry.captureMessage(`platform rollup ${day}: failed ${r.failed.map(f => f.group).join(',') || '-'} skipped ${r.skipped.join(',') || '-'}`, { level: 'error', tags: { area: 'cron' } });
        else console.log('[platform-rollup]', JSON.stringify({ day, ran: r.ran, rows: r.rows.length, elapsedMs: r.elapsedMs }));
      },
      err => reportRouteError('[platform-rollup] failed:', err)
    )
  );
  return NextResponse.json({ ok: true, started: true, day }, { status: 202 });
}
