// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/structure/teams ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { TeamCreateSchema, TeamPatchSchema } from '@/lib/structure/validate';
import { requireOrgManager, teamCreatePOST, teamPATCH } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/structure/teams — manager team CRUD (phase 1) ────────
// NO manager DELETE on purpose: archive is the manager affordance; teams
// persist (rollover re-enters the same row) and hard-delete stays an admin
// mistake-cleanup tool.

export async function structureTeamsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_teams' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, TeamCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.side !== kind || parsed.data.orgId !== id) {
      return NextResponse.json({ error: 'Body organization does not match the URL' }, { status: 400 });
    }
    return await teamCreatePOST(admin, { side: kind, orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] teams POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { id, status } — archive/restore, scoped to this org. */
export async function structureTeamsRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    // Org staff program: the scope comes from the body, so parse first — a
    // division-scoped grant covers the teams entered in that division.
    const parsed = await parseBody(request, TeamPatchSchema);
    if (!parsed.success) return parsed.response;
    const gate = await requireOrgManager(admin, user, kind, id, {
      intent: 'manage_teams',
      scope: { type: 'team', id: parsed.data.id, parentDivisionIds: await divisionIdsForTeam(admin, parsed.data.id) },
    });
    if (!gate.ok) return gate.response;
    return await teamPATCH(admin, parsed.data, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] teams PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
