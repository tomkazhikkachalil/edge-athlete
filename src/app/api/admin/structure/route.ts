import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { structureAggregateGET } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/structure?side=&orgId= — the admin console's aggregate ───────
// Thin wrapper since round 1 of phase 1; the query lives in
// orgs/structure-server.ts, shared with the org-manager twins.

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const side = searchParams.get('side');
    const orgId = searchParams.get('orgId');
    if ((side !== 'league' && side !== 'club') || !orgId || !UUID_RE.test(orgId)) {
      return NextResponse.json({ error: 'side and orgId are required' }, { status: 400 });
    }
    return await structureAggregateGET(getSupabaseAdmin(), { side, orgId });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN STRUCTURE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
