import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { runPlatformRollup } from '@/lib/platform-stats/rollup-server';
import { recomputableDay } from '@/lib/platform-stats/metrics';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 120;

/**
 * POST /api/admin/platform-stats/recompute?day=YYYY-MM-DD — the Overview's
 * Recompute door (H1): one day, every group, synchronous, owner-only. The
 * backfill is a loop over this with the console cookie. Answers the rows it
 * wrote; `supported: false` pre-267; a group that failed is named.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const day = request.nextUrl.searchParams.get('day') ?? '';
    if (!recomputableDay(day)) return NextResponse.json({ error: 'day must be YYYY-MM-DD, not in the future, within 400 days' }, { status: 400, headers: NO_STORE });
    const result = await runPlatformRollup(getSupabaseAdmin(), day, { budgetMs: 100_000 });
    return NextResponse.json(result, { status: result.supported ? 200 : 503, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/platform-stats/recompute]', error);
    return NextResponse.json({ error: 'Could not recompute that day' }, { status: 500, headers: NO_STORE });
  }
}
