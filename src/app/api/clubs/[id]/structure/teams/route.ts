import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { TeamCreateSchema, TeamPatchSchema } from '@/lib/structure/validate';
import { requireOrgManager, teamCreatePOST, teamPATCH } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';

// ── /api/clubs/[id]/structure/teams — manager team CRUD (phase 1) ────────
// NO manager DELETE on purpose: archive is the manager affordance; teams
// persist (rollover re-enters the same row) and hard-delete stays an admin
// mistake-cleanup tool.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_teams' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, TeamCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.side !== 'club' || parsed.data.orgId !== id) {
      return NextResponse.json({ error: 'Body organization does not match the URL' }, { status: 400 });
    }
    return await teamCreatePOST(admin, { side: 'club', orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] teams POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { id, status } — archive/restore, scoped to this org. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    // Org staff program: the scope comes from the body, so parse first — a
    // division-scoped grant covers the teams entered in that division.
    const parsed = await parseBody(request, TeamPatchSchema);
    if (!parsed.success) return parsed.response;
    const gate = await requireOrgManager(admin, user, 'club', id, {
      intent: 'manage_teams',
      scope: { type: 'team', id: parsed.data.id, parentDivisionIds: await divisionIdsForTeam(admin, parsed.data.id) },
    });
    if (!gate.ok) return gate.response;
    return await teamPATCH(admin, parsed.data, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] teams PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
