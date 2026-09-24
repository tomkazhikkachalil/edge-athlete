// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/competitions/[competitionId]/season-announce ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { seasonAnnounceGET, seasonAnnouncePOST } from '@/lib/competitions/golf-season-wrap-server';
import { pinCompetitionToOrg, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/competitions/[competitionId]/season-announce (P6) ──
// GET: the season summary + whether it was announced. POST: announce it
// once (the announce rails — bells, guardian copies, the site notice).

async function gate(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  const user = await requireAuth(request);
  const { id, competitionId } = params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { response: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managerGate = await requireCompetitionManager(admin, user, kind, id, { competitionId });
  if (!managerGate.ok) return { response: managerGate.response };
  const comp = await pinCompetitionToOrg(admin, { side: kind, orgId: id }, competitionId);
  if (!comp) {
    return { response: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  return { user, admin, id, competitionId };
}

export async function competitionsOneSeasonAnnounceRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    return await seasonAnnounceGET(g.admin, kind, g.id, g.competitionId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[SEASON WRAP] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function competitionsOneSeasonAnnounceRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-announce', { userId: user.id });
    if (limited) return limited;
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    return await seasonAnnouncePOST(g.admin, kind, g.id, g.competitionId, g.user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[SEASON WRAP] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
