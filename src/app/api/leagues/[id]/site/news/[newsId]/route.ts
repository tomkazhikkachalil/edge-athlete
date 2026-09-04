import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { NewsPatchSchema } from '@/lib/org-sites/validate';
import { newsDELETE, newsGET, newsPATCH } from '@/lib/org-sites/news-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/site/news/[newsId] — one news post (phase 3 R3) ──────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; newsId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id, newsId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await newsGET(admin, 'league', id, newsId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE NEWS] league page GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; newsId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, newsId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, NewsPatchSchema);
    if (!parsed.success) return parsed.response;
    return await newsPATCH(admin, 'league', id, newsId, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE NEWS] league page PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; newsId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, newsId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await newsDELETE(admin, 'league', id, newsId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG SITE NEWS] league page DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
