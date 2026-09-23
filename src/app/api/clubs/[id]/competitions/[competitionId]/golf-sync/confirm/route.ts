import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { confirmGolfContest } from '@/lib/competitions/golf-league-server';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { type OrgKindRow, orgIdOf, orgKindOf } from '@/lib/orgs/org-ref';

// ── /api/clubs/[id]/competitions/[competitionId]/golf-sync/confirm (G2) ──
// "Confirm rounds": self_reported → league_verified (confirmed_by = the
// manager), the round completes, standings recompute.

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
    const gate = await requireCompetitionManager(admin, user, 'club', id, { competitionId });
    if (!gate.ok) return gate.response;
    const body = (await request.json().catch(() => ({}))) as { contestId?: unknown };
    if (typeof body.contestId !== 'string' || !UUID_RE.test(body.contestId)) {
      return NextResponse.json({ error: 'contestId is required' }, { status: 400 });
    }
    const { data: contest } = await admin
      .from('contests')
      .select('id, competition:competition_id (id, org_id, org:organizations(kind))')
      .eq('id', body.contestId)
      .maybeSingle();
    const comp = contest?.competition as ({ id: string } & OrgKindRow) | ({ id: string } & OrgKindRow)[] | null | undefined;
    const compRow = Array.isArray(comp) ? comp[0] : comp;
    if (!contest || !compRow || compRow.id !== competitionId || orgIdOf(compRow) !== id || orgKindOf(compRow) !== 'club') {
      return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    }
    return await confirmGolfContest(admin, body.contestId, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GOLF LEAGUE] club confirm error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
