import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { widgetDataGET } from '@/lib/org-sites/canvas-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/widget-data?keys=a,b — the picker's live tiles
// (Site Builder P3-D): the home data for widgets not yet on the layout,
// resolved against fresh default instances, plus each key's emptiness.
// manage_site; the `org-site` bucket; 404 when the flag is off.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await widgetDataGET(admin, 'league', id, request.nextUrl.searchParams.get('keys'));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE WIDGET DATA] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
