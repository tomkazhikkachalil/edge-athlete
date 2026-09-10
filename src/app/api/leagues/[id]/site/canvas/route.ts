import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { canvasGET } from '@/lib/org-sites/canvas-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/canvas — the editor's one read (Site Builder P3-B):
// the DRAFT view of the site, the layout it edits, the draft's rev, and the
// home data resolved against that layout. manage_site (the surface flag
// that once 404'd this route retired in P10-C).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    // B5: the editor's read shares the autosave's bucket (a reload per publish, a re-read per content save).
    const limited = await enforceRateLimit(request, 'org-site-draft', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await canvasGET(admin, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE CANVAS] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
