import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { orgVenuePATCH, orgVenueDELETE } from '@/lib/venues/org-venues-server';
import { OrgVenuePatchSchema } from '@/lib/venues/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/venues/[venueId] — edit / link / delete (phase 6b A1) ──
// Manager-gated twins; the org-column filter inside the core is what keeps
// a venueId from another org answering 404.

async function gate(request: NextRequest, params: Promise<{ id: string; venueId: string }>) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
  if (limited) return { response: limited };
  const { id, venueId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(venueId)) {
    return { response: NextResponse.json({ error: 'Venue not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managed = await requireOrgManager(admin, user, 'club', id);
  if (!managed.ok) return { response: managed.response };
  return { admin, id, venueId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; venueId: string }> }
) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, OrgVenuePatchSchema);
    if (!parsed.success) return parsed.response;
    return await orgVenuePATCH(g.admin, { side: 'club', orgId: g.id }, g.venueId, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG VENUES] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; venueId: string }> }
) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    return await orgVenueDELETE(g.admin, { side: 'club', orgId: g.id }, g.venueId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG VENUES] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
