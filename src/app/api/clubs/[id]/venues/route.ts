import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { orgVenuesGET, orgVenueCreatePOST } from '@/lib/venues/org-venues-server';
import { OrgVenueCreateSchema } from '@/lib/venues/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/venues — the org's venues + golf links (phase 6b A1) ──
// GET is anonymous-tolerant (the public club page's Courses section reads
// it; venues/facilities/golf_courses are public reference tables). POST is
// manager-gated; the query lives in venues/org-venues-server.ts.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    await getServerAuth(request); // optional session; the read is public
    return await orgVenuesGET(getSupabaseAdmin(), { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG VENUES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_venues' });
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, OrgVenueCreateSchema);
    if (!parsed.success) return parsed.response;
    return await orgVenueCreatePOST(admin, { side: 'club', orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG VENUES] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
