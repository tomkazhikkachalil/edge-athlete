import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { PageCreateSchema } from '@/lib/org-sites/validate';
import { pageCreatePOST, pagesGET } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/pages — page list + create (phase 3 R3) ─────────
// manage_org gates it; writes ride the org-site-pages bucket (editor
// saves must not burn the 30/h org-site budget).

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
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await pagesGET(admin, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, PageCreateSchema);
    if (!parsed.success) return parsed.response;
    return await pageCreatePOST(admin, 'league', id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
