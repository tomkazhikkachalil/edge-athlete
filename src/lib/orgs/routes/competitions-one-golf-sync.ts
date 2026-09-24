// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/competitions/[competitionId]/golf-sync ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { golfSyncPOST } from '@/lib/competitions/golf-league-server';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { type OrgKind, orgIdOf, orgKindOf } from '@/lib/orgs/org-ref';

// ── /api/{leagues,clubs}/[id]/competitions/[competitionId]/golf-sync (phase 6c G2) ──
// "Sync rounds": fill one league round (body { contestId }) or every
// open round of the competition from the members' posted golf rounds.
// Manager-gated; the org-competitions bucket. Results land self_reported.

export async function competitionsOneGolfSyncRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, kind, id, { competitionId });
    if (!gate.ok) return gate.response;
    const { data: comp } = await admin
      .from('competitions')
      .select('id, org_id, org:organizations(kind)')
      .eq('id', competitionId)
      .maybeSingle();
    if (!comp || orgIdOf(comp) !== id || orgKindOf(comp) !== kind) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { contestId?: unknown };
    const contestId = typeof body.contestId === 'string' && UUID_RE.test(body.contestId) ? body.contestId : null;
    return await golfSyncPOST(admin, competitionId, contestId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[GOLF LEAGUE] ${kind} sync error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
