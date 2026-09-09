import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { draftLayoutPUT } from '@/lib/org-sites/canvas-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/draft — the editor's save (Site Builder P3-B):
// PUT { layout, baseRev? } validates the envelope + geometry and writes the
// layout into the draft snapshot, rev-guarded (409 on a stale baseRev).
// manage_site; the `org-site` content bucket; 404 when the flag is off.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const body = await request.json().catch(() => null);
    return await draftLayoutPUT(admin, 'club', id, user.id, body);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE DRAFT] club PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
