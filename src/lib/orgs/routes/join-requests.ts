// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/join-requests ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { OrgJoinDecisionSchema } from '@/lib/orgs/validate';
import { capabilityAllows, getOrgAndCapabilities } from '@/lib/orgs/authz';
import { decideJoinRequest, listJoinRequests } from '@/lib/orgs/join-requests-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/join-requests — the approval queue (program 11 L1) ───
// The league twin of /api/clubs/[id]/join-requests: GET the queue; PATCH
// {requestId, decision} approves (the existing join) or declines. Managers
// only (manage_members).

async function gate(request: NextRequest, kind: OrgKind, params: { id: string }) {
  const user = await requireAuth(request);
  const { id } = params;
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndCapabilities(admin, kind, id, user.id);
  if (loaded.status !== 'found') return { response: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  const isOwnerColumn = loaded.org.owner_profile_id === user.id;
  if (!capabilityAllows(loaded.caps, 'manage_membership') && !isOwnerColumn) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user, admin, org: { id, name: loaded.org.name as string } };
}

export async function joinRequestsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    return await listJoinRequests(g.admin, kind, g.org.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE JOIN REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function joinRequestsRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, OrgJoinDecisionSchema);
    if (!parsed.success) return parsed.response;
    return await decideJoinRequest(g.admin, kind, g.org, parsed.data.requestId, parsed.data.decision);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE JOIN REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
