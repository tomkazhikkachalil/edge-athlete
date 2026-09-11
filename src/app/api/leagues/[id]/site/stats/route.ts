import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { statsGET } from '@/lib/org-sites/analytics-server';
import { statsRange } from '@/lib/org-sites/analytics-rollup';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/stats?days=7|30|90 — the site's visitors (program 2, E2)
// manage_site gates it (the same as the editor).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await statsGET(admin, 'league', id, statsRange(request.nextUrl.searchParams.get('days')));
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SITE ANALYTICS] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
