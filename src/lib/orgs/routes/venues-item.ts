// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/venues/[venueId] ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { orgVenuePATCH, orgVenueDELETE } from '@/lib/venues/org-venues-server';
import { OrgVenuePatchSchema } from '@/lib/venues/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/venues/[venueId] — edit / link / delete (phase 6b A1) ──
// Manager-gated twins; the org-column filter inside the core is what keeps
// a venueId from another org answering 404.

async function gate(request: NextRequest, kind: OrgKind, params: { id: string; venueId: string }) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
  if (limited) return { response: limited };
  const { id, venueId } = params;
  if (!UUID_RE.test(id) || !UUID_RE.test(venueId)) {
    return { response: NextResponse.json({ error: 'Venue not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managed = await requireOrgManager(admin, user, kind, id, { intent: 'manage_venues' });
  if (!managed.ok) return { response: managed.response };
  return { admin, id, venueId };
}

export async function venuesItemRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string; venueId: string }) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, OrgVenuePatchSchema);
    if (!parsed.success) return parsed.response;
    return await orgVenuePATCH(g.admin, { side: kind, orgId: g.id }, g.venueId, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG VENUES] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function venuesItemRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string; venueId: string }) {
  try {
    const g = await gate(request, kind, params);
    if ('response' in g) return g.response;
    return await orgVenueDELETE(g.admin, { side: kind, orgId: g.id }, g.venueId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG VENUES] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
