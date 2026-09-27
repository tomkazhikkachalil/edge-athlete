// ── One handler for both kinds: /api/{leagues,clubs}/[id]/teams/[teamId]/logo ──
// Teams & divisions program, PR 6. The shims pass their kind; the gate lives
// HERE: `manage_teams` at the TEAM's scope (an org-wide Teams grant, or a
// coach's grant on the team or its division — the roster routes' gate).

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';
import { reportRouteError } from '@/lib/observability/report';
import { teamLogoDELETE, teamLogoPOST } from '@/lib/teams/logo-server';

type Params = { id: string; teamId: string };

async function gate(request: NextRequest, kind: OrgKind, params: Params) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
  if (limited) return { response: limited };
  if (!UUID_RE.test(params.id)) return { response: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  if (!UUID_RE.test(params.teamId)) return { response: NextResponse.json({ error: 'Team not found' }, { status: 404 }) };
  const admin = getSupabaseAdmin();
  const allowed = await requireOrgManager(admin, user, kind, params.id, {
    intent: 'manage_teams',
    scope: { type: 'team', id: params.teamId, parentDivisionIds: await divisionIdsForTeam(admin, params.teamId) },
  });
  if (!allowed.ok) return { response: allowed.response };
  return { admin };
}

export async function teamLogoRoutePOST(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    const formData = await request.formData();
    const file = formData.get('logo') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    return await teamLogoPOST(g.admin, params.id, params.teamId, file);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[TEAM LOGO] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function teamLogoRouteDELETE(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    return await teamLogoDELETE(g.admin, params.id, params.teamId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[TEAM LOGO] ${kind} DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
