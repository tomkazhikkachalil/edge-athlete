import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { PAR_SETTLE_WRITES, sweepParSettlement } from '@/lib/golf/par-evidence-server';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * POST /api/admin/golf-par-review — judge every course that holds provider tee
 * boxes against its evidence (migration 317) and say which pars independent
 * evidence settles. A DRY RUN unless the body says `dryRun: false` AND the
 * app's own corrections are switched on (PAR_SETTLE_WRITES): until then every
 * call only reports.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as { dryRun?: unknown; limit?: unknown } | null;
    const limit = typeof body?.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, 2000) : undefined;
    const sweep = await sweepParSettlement(getSupabaseAdmin(), { dryRun: body?.dryRun !== false, limit });
    return NextResponse.json(
      {
        dryRun: sweep.dryRun,
        writesEnabled: PAR_SETTLE_WRITES,
        courses: sweep.courses,
        changed: sweep.changed.map(r => ({ courseId: r.courseId, name: r.name, applied: r.applied, skipped: r.skipped ?? null, corrections: r.corrections, disputed: r.disputed })),
        waiting: sweep.waiting,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-par-review]', error);
    return NextResponse.json({ error: 'Could not judge the scorecards' }, { status: 500, headers: NO_STORE });
  }
}
