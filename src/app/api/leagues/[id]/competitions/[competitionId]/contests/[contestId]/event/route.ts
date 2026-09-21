import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ContestRunAsEventSchema } from '@/lib/competitions/validate';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { contestRunAsEventPOST } from '@/lib/sport-events/contest-door-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/leagues/[id]/competitions/[competitionId]/contests/[contestId]/event (track 2 PR 10) ──
// Run a two-sided contest as a one-round game EVENT hosted for the org: the sides pre-filled from the entries, the link stamped.
// Manager-gated; the body/URL competition mismatch guard runs BEFORE the lib call.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string; contestId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId, contestId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId) || !UUID_RE.test(contestId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ContestRunAsEventSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId || parsed.data.contestId !== contestId) {
      return NextResponse.json({ error: 'Body competition or contest does not match the URL' }, { status: 400 });
    }
    return await contestRunAsEventPOST(admin, parsed.data, { side: 'league', orgId: id }, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[COMPETITIONS] league contest run-as-event POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
