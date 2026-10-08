import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { WORK_BUDGET_MS } from '@/lib/golf/map-sweep';
import { planSweepCells, readSweepProgress, runElevationBatch, runGeometryBatch, runHydrationBatch } from '@/lib/golf/map-sweep-server';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 60;

// ── POST /api/cron/golf-map-sweep ─────────────────────────────────────────────
// One tick of the course-map sweep (migration 255 schedules it every two
// minutes on production through pg_cron; staging has no schedule, by
// decision). Each phase runs in its own try/catch (the daily route's
// pattern) inside one time budget:
//   1. plan — when the plan is older than a day (new courses join their cells)
//   2. geometry — up to four cells (the time guard usually allows 2–4)
//   3. elevation — with whatever time is left (≈ 20 courses)
//   4. hydration — three provider rows
// Nothing here is a schedule of its own: without CRON_SECRET it answers 401.
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const t0 = Date.now();
  const summary: Record<string, unknown> = { ok: true };
  try {
    const progress = await readSweepProgress(admin);
    if (!progress.ok) {
      summary.ok = false;
      summary.error = progress.error;
      return NextResponse.json(summary, { status: progress.error.includes('255') ? 409 : 500 });
    }
    const planAt = (progress.plan as { at?: string } | null)?.at;
    if (!planAt || Date.now() - Date.parse(planAt) > 24 * 60 * 60 * 1000) {
      summary.plan = await planSweepCells(admin, { dryRun: false });
    }
  } catch (e) {
    reportRouteError('[map-sweep] plan phase failed:', e);
    summary.plan = { ok: false };
  }
  try {
    summary.geometry = await runGeometryBatch(admin, { cells: 4, dryRun: false, now: t0 });
  } catch (e) {
    reportRouteError('[map-sweep] geometry phase failed:', e);
    summary.geometry = { ok: false };
  }
  try {
    const left = WORK_BUDGET_MS - (Date.now() - t0);
    if (left > 8000) summary.elevation = await runElevationBatch(admin, { courses: 20, dryRun: false, deadlineMs: left });
  } catch (e) {
    reportRouteError('[map-sweep] elevation phase failed:', e);
    summary.elevation = { ok: false };
  }
  try {
    if (WORK_BUDGET_MS - (Date.now() - t0) > 8000) summary.hydration = await runHydrationBatch(admin, { rows: 3, dryRun: false });
  } catch (e) {
    reportRouteError('[map-sweep] hydration phase failed:', e);
    summary.hydration = { ok: false };
  }
  summary.elapsedMs = Date.now() - t0;
  return NextResponse.json(summary);
}
