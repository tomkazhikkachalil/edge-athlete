import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { PAR_SETTLE_WRITES, decideHolePar, readParReview, sweepParSettlement } from '@/lib/golf/par-evidence-server';
import { UUID_RE } from '@/lib/uuid';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * GET /api/admin/golf-par-review — the saved scorecards with holes still
 * waiting for a person (migration 317; par-evidence.ts), most-picked course
 * first, and the last recorded par changes.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ ...(await readParReview(getSupabaseAdmin())), writesEnabled: PAR_SETTLE_WRITES }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-par-review]', error);
    return NextResponse.json({ error: 'Could not read the scorecards under review' }, { status: 500, headers: NO_STORE });
  }
}

const DECISION_ERRORS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: 'Course not found' },
  no_card: { status: 409, error: 'This course has no saved scorecard' },
  bad_hole: { status: 400, error: 'That hole is not on this scorecard' },
  bad_par: { status: 400, error: 'A par is 3, 4, 5 or 6' },
  note_required: { status: 400, error: 'No source gave that par: add a note saying where it comes from' },
  write_failed: { status: 500, error: 'The par could not be saved' },
};

/**
 * POST /api/admin/golf-par-review
 *   { courseId, hole, par, note? } — an admin decides one hole's par: kept as
 *     evidence, the saved card corrected at once, the change recorded with the
 *     admin's email.
 *   anything else — judge every course that holds provider tee boxes and say
 *     which pars independent evidence settles. A DRY RUN unless `dryRun: false`
 *     AND the app's own corrections are switched on (PAR_SETTLE_WRITES).
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as { courseId?: unknown; hole?: unknown; par?: unknown; note?: unknown; dryRun?: unknown; limit?: unknown } | null;
    const admin = getSupabaseAdmin();
    if (body && body.courseId !== undefined) {
      if (typeof body.courseId !== 'string' || !UUID_RE.test(body.courseId)) return NextResponse.json({ error: 'Course not found' }, { status: 404, headers: NO_STORE });
      if (typeof body.hole !== 'number' || typeof body.par !== 'number') return NextResponse.json({ error: 'A hole and a par are needed' }, { status: 400, headers: NO_STORE });
      const decision = await decideHolePar(admin, { courseId: body.courseId, hole: body.hole, par: body.par, actor: actor.email, note: typeof body.note === 'string' ? body.note : null });
      if (!decision.ok) return NextResponse.json({ error: DECISION_ERRORS[decision.error].error, code: decision.error }, { status: DECISION_ERRORS[decision.error].status, headers: NO_STORE });
      return NextResponse.json({ changed: decision.changed, corrections: decision.result.corrections, stillOpen: decision.result.disputed }, { headers: NO_STORE });
    }
    const limit = typeof body?.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0 ? Math.min(body.limit, 2000) : undefined;
    const sweep = await sweepParSettlement(admin, { dryRun: body?.dryRun !== false, limit });
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
