import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { PagePatchSchema } from '@/lib/org-sites/validate';
import { pageDELETE, pageGET, pagePATCH } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/pages/[pageId] — one page (phase 3 R3) ──────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id, pageId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await pageGET(admin, 'league', id, pageId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] league page GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, pageId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, PagePatchSchema);
    if (!parsed.success) return parsed.response;
    return await pagePATCH(admin, 'league', id, pageId, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] league page PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, pageId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await pageDELETE(admin, 'league', id, pageId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE PAGES] league page DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
