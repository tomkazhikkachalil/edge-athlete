import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { readCardFillProgress, runCardFillBatch, runCardLink } from '@/lib/golf/card-fill-server';
import { reportRouteError } from '@/lib/observability/report';

// The link reads a 2 MB file and the catalog's US rows; a batch is a few
// provider calls. Both fit in a minute.
export const maxDuration = 60;

const status = (error: string) => (error.includes('314') ? 409 : 500);

/**
 * GET /api/admin/golf-card-fill — the scorecard fill's progress.
 * POST — one step: { phase: 'link' | 'cards', rows?: 1–40, dryRun?: boolean }.
 * DRY RUN BY DEFAULT — a live step needs an explicit { "dryRun": false }.
 * Admin-only. The cron tick (/api/cron/golf-map-sweep) runs the same two
 * phases on a schedule; this is the owner's door (card-fill-server.ts).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const progress = await readCardFillProgress(getSupabaseAdmin());
    if (!progress.ok) return NextResponse.json({ error: progress.error }, { status: status(progress.error) });
    return NextResponse.json(progress, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-card-fill] progress error:', error);
    return NextResponse.json({ error: 'Card fill progress failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const phase = typeof body?.phase === 'string' ? body.phase : '';
    if (phase !== 'link' && phase !== 'cards') return NextResponse.json({ error: 'phase must be link or cards' }, { status: 400 });
    const dryRun = body?.dryRun !== false;
    const rows = typeof body?.rows === 'number' && Number.isFinite(body.rows) ? Math.max(1, Math.min(Math.floor(body.rows), 40)) : 10;
    const result = phase === 'link' ? await runCardLink(admin, { dryRun }) : await runCardFillBatch(admin, { rows, dryRun });
    if ('ok' in result && result.ok === false) return NextResponse.json({ error: result.error }, { status: status(result.error) });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-card-fill] step error:', error);
    return NextResponse.json({ error: 'Card fill step failed' }, { status: 500 });
  }
}
