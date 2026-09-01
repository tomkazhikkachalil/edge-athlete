import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { NewsCreateSchema } from '@/lib/org-sites/validate';
import { newsCreatePOST, newsListGET } from '@/lib/org-sites/news-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/site/news — news list + create (phase 3 R3) ─────────
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
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    return await newsListGET(admin, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE NEWS] club GET error:', error);
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
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, NewsCreateSchema);
    if (!parsed.success) return parsed.response;
    return await newsCreatePOST(admin, 'club', id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE NEWS] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
