import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { readSiteCardProgress, runSiteCardBatch } from '@/lib/golf/site-card-server';
import { reportRouteError } from '@/lib/observability/report';

// Two courses' websites, a handful of fetches each.
export const maxDuration = 120;

const status = (error: string) => (error.includes('315') ? 409 : 500);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/golf-site-cards — the website scorecard reader's progress:
 * visits by outcome and the last cards saved, each with where it was read.
 * POST — one step: { rows?: 1–2, courseId?: uuid, dryRun?: boolean }.
 * DRY RUN BY DEFAULT — a live step needs an explicit { "dryRun": false }.
 * Admin-only. The schedule (/api/cron/golf-site-cards) runs the same step
 * every five minutes; this is the owner's door (site-card-server.ts).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const progress = await readSiteCardProgress(getSupabaseAdmin());
    if (!progress.ok) return NextResponse.json({ error: progress.error }, { status: status(progress.error) });
    return NextResponse.json(progress, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-site-cards] progress error:', error);
    return NextResponse.json({ error: 'Site card progress failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => ({}));
    const courseId = typeof body?.courseId === 'string' ? body.courseId : undefined;
    if (courseId !== undefined && !UUID.test(courseId)) return NextResponse.json({ error: 'courseId must be a course id' }, { status: 400 });
    const dryRun = body?.dryRun !== false;
    const rows = typeof body?.rows === 'number' && Number.isFinite(body.rows) ? Math.max(1, Math.min(Math.floor(body.rows), 2)) : 2;
    const result = await runSiteCardBatch(getSupabaseAdmin(), { rows, dryRun, courseId });
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'failed' }, { status: status(result.error ?? '') });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-site-cards] step error:', error);
    return NextResponse.json({ error: 'Site card step failed' }, { status: 500 });
  }
}
