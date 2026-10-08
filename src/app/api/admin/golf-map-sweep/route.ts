import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { cellBounds } from '@/lib/golf/map-sweep';
import { planSweepCells, readSweepProgress, runElevationBatch, runGeometryBatch, runHydrationBatch } from '@/lib/golf/map-sweep-server';
import { reportRouteError } from '@/lib/observability/report';

// One batch of the course-map sweep fits in a minute (map-sweep.ts WORK_BUDGET_MS).
export const maxDuration = 60;

const PHASES = new Set(['plan', 'geometry', 'elevation', 'hydration']);

/**
 * GET /api/admin/golf-map-sweep — the sweep's progress (the dashboard panel).
 * POST — one batch: { phase: 'plan' | 'geometry' | 'elevation' | 'hydration',
 * cells?: 1–6, courses?: 1–50, rows?: 1–20, cellKey?: 'c05:45.0:-76.0',
 * dryRun?: boolean }. DRY RUN BY DEFAULT — a live batch needs an explicit
 * { "dryRun": false }. Admin-only (the backfill's shape). The cron twin runs
 * the same phases on a schedule; this is the owner's door.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const progress = await readSweepProgress(getSupabaseAdmin());
    if (!progress.ok) return NextResponse.json({ error: progress.error }, { status: progress.error.includes('255') ? 409 : 500 });
    return NextResponse.json(progress);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-map-sweep] progress error:', error);
    return NextResponse.json({ error: 'Sweep progress failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const phase = typeof body?.phase === 'string' ? body.phase : '';
    if (!PHASES.has(phase)) return NextResponse.json({ error: 'phase must be plan, geometry, elevation or hydration' }, { status: 400 });
    const dryRun = body?.dryRun !== false;
    const cellKey = typeof body?.cellKey === 'string' && body.cellKey.trim() ? body.cellKey.trim() : null;
    if (cellKey && !cellBounds(cellKey)) return NextResponse.json({ error: 'cellKey is not a cell this sweep knows (c05:<lat>:<lng>)' }, { status: 400 });
    const n = (v: unknown, dflt: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(Math.floor(v), max)) : dflt);

    const result =
      phase === 'plan' ? await planSweepCells(admin, { dryRun })
      : phase === 'geometry' ? await runGeometryBatch(admin, { cells: n(body?.cells, 2, 6), dryRun, cellKey })
      : phase === 'elevation' ? await runElevationBatch(admin, { courses: n(body?.courses, 20, 50), dryRun })
      : await runHydrationBatch(admin, { rows: n(body?.rows, 5, 20), dryRun });
    if ('ok' in result && result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: result.error.includes('255') ? 409 : result.error.includes('cell') ? 400 : 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-map-sweep] batch error:', error);
    return NextResponse.json({ error: 'Sweep batch failed' }, { status: 500 });
  }
}
