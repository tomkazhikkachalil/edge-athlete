import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { PoolsSeedSchema } from '@/lib/competitions/validate';
import { poolsSeedPOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/leagues/[id]/competitions/[competitionId]/pools/seed (leftovers PR 2) ──
// Seed a bracket competition from the pools' tables — the top n of each pool, crossed.
// Manager-gated; the body/URL competition mismatch guard runs BEFORE the lib call.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, PoolsSeedSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId) {
      return NextResponse.json({ error: 'Body competition does not match the URL' }, { status: 400 });
    }
    return await poolsSeedPOST(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[COMPETITIONS] league pools seed POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
