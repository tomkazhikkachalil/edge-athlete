import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { decodeCursor, isBackfillSource } from '@/lib/performance/backfill';
import { runPerformanceBackfill } from '@/lib/performance/backfill-server';
import { reportRouteError } from '@/lib/observability/report';

// Ten pages of five hundred origin rows, each mapped and upserted.
export const maxDuration = 60;

/**
 * POST /api/admin/performance-backfill — project the rows that predate the
 * F4 write hooks into athlete_performances (data foundation, F5). Admin-only
 * (the storage sweep's shape). Body: { source, cursor?, dryRun? }.
 * DRY RUN BY DEFAULT — writing requires an explicit { "dryRun": false }.
 * One source per call; continue with the answer's `nextCursor` while
 * `truncated` is true. Run order: golf_rounds → posts → contest_stat_lines
 * → contest_results last (the league overlays win).
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const source = body?.source;
    if (!isBackfillSource(source)) {
      return NextResponse.json(
        { error: 'source must be golf_rounds, posts, contest_stat_lines or contest_results' },
        { status: 400 }
      );
    }
    const cursor = body?.cursor === undefined || body?.cursor === null ? null : decodeCursor(body.cursor);
    if (body?.cursor !== undefined && body?.cursor !== null && !cursor) {
      return NextResponse.json({ error: 'cursor is not one this endpoint issued' }, { status: 400 });
    }
    const dryRun = body?.dryRun !== false;

    const result = await runPerformanceBackfill(admin, { source, cursor, dryRun });
    if (!result.ok) {
      if (result.error === 'missing_table') {
        return NextResponse.json(
          { error: 'athlete_performances is missing — run migration 194 first' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'Backfill read failed — see the server log' }, { status: 500 });
    }
    return NextResponse.json(result.summary);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[performance-backfill] error:', error);
    return NextResponse.json({ error: 'Performance backfill failed' }, { status: 500 });
  }
}
