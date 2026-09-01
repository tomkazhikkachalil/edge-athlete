import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { slugOptionsGET } from '@/lib/org-sites/server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/slug-options — the league twin's mirror ────────────
// See leagues/[id]/site/slug-options/route.ts.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    const candidate = new URL(request.url).searchParams.get('candidate');
    return await slugOptionsGET(admin, 'club', id, candidate);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITES] club slug-options error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
