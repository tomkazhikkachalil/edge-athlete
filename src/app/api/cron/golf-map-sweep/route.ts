import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { CRON_ELEVATION_PHASE_MS } from '@/lib/golf/map-sweep';
import { planSweepCells, readSweepProgress, runElevationBatch, runGeometryBatch, runHydrationBatch } from '@/lib/golf/map-sweep-server';
import { CRON_CARD_PHASE_MS, cardLinkDue, runCardFillBatch, runCardLink } from '@/lib/golf/card-fill-server';
import { reportRouteError } from '@/lib/observability/report';
import { recordJobSummary } from '@/lib/platform-jobs/record';

// Longer than map-sweep.ts WORK_BUDGET_MS (map-sweep.test.ts pins it).
export const maxDuration = 120;

// ── POST /api/cron/golf-map-sweep ─────────────────────────────────────────────
// One tick of the course-map sweep (migration 255 schedules it every two
// minutes on production through pg_cron; staging has no schedule, by
// decision). Each phase runs in its own try/catch (the daily route's
// pattern) inside one time budget. The order is by cost: the short, bounded
// phases first, geometry LAST with everything that is left. (Until Nov 17
// 2026 geometry ran first and, on production, spent the whole tick on cells
// that timed out: nothing placed after it ran.)
//   1. plan — when the plan is older than a day (new courses join their cells)
//   2. cards — the scorecard fill (migration 314): the monthly link when it
//      is due, else two linked rows' cards. Its own daily cap ('card-fill')
//      is what paces it, not this number.
//   3. elevation — about twelve seconds of courses (CRON_ELEVATION_PHASE_MS)
//   4. hydration — three provider rows
//   5. geometry — up to four cells; a cell starts only while one whole
//      request and its processing still fit (the guard counts from the
//      tick's start), which on a slow Overpass day is one cell.
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
    if (await cardLinkDue(admin)) summary.cardLink = await runCardLink(admin, { dryRun: false });
    else summary.cards = await runCardFillBatch(admin, { rows: 2, dryRun: false, deadlineMs: CRON_CARD_PHASE_MS });
  } catch (e) {
    reportRouteError('[map-sweep] card fill phase failed:', e);
    summary.cards = { ok: false };
  }
  try {
    summary.elevation = await runElevationBatch(admin, { courses: 20, dryRun: false, deadlineMs: CRON_ELEVATION_PHASE_MS });
  } catch (e) {
    reportRouteError('[map-sweep] elevation phase failed:', e);
    summary.elevation = { ok: false };
  }
  try {
    summary.hydration = await runHydrationBatch(admin, { rows: 3, dryRun: false });
  } catch (e) {
    reportRouteError('[map-sweep] hydration phase failed:', e);
    summary.hydration = { ok: false };
  }
  try {
    // `now: t0`: the batch's own guard counts the earlier phases' time.
    summary.geometry = await runGeometryBatch(admin, { cells: 4, dryRun: false, now: t0 });
  } catch (e) {
    reportRouteError('[map-sweep] geometry phase failed:', e);
    summary.geometry = { ok: false };
  }
  summary.elapsedMs = Date.now() - t0;
  await recordJobSummary(admin, 'golf-map-sweep', new Date(t0), summary);
  return NextResponse.json(summary);
}
