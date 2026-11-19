import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runSiteCardBatch } from '@/lib/golf/site-card-server';
import { reportRouteError } from '@/lib/observability/report';
import { recordJobSummary } from '@/lib/platform-jobs/record';

// Longer than site-card-server.ts SITE_TICK_BUDGET_MS (site-card-server.test.ts pins it).
export const maxDuration = 120;

// ── POST /api/cron/golf-site-cards ───────────────────────────────────────────
// One tick of the website scorecard reader (migration 315 schedules it every
// five minutes on production through pg_cron; staging has no schedule). Two
// courses a tick: each one's own website is visited once, a scorecard it
// publishes as text is read by rule (no model), and it is saved only when
// every check passes. A route of its own so the map tick's clocks are not
// touched. Without CRON_SECRET it answers 401.
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const started = new Date();
  let summary: Record<string, unknown>;
  try {
    summary = { ...(await runSiteCardBatch(admin, { rows: 2, dryRun: false })) };
  } catch (e) {
    reportRouteError('[site-cards] tick failed:', e);
    summary = { ok: false, phase: 'site-cards' };
  }
  await recordJobSummary(admin, 'golf-site-cards', started, summary).catch(() => undefined);
  return NextResponse.json(summary, { status: summary.ok === false && summary.error === 'migration 315 has not run' ? 409 : 200 });
}
