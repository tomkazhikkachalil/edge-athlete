import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { requireOrgManager, structureAggregateGET } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/structure — the org-manager aggregate (phase 1) ──────
// Thin wrapper; the query + gate live in orgs/structure-server.ts.
// includeCounts feeds the console's setup checklist.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await structureAggregateGET(admin, { side: 'league', orgId: id }, { includeCounts: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
