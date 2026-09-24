// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/news/[newsId] ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { NewsPatchSchema } from '@/lib/org-sites/validate';
import { newsDELETE, newsGET, newsPATCH } from '@/lib/org-sites/news-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/news/[newsId] — one news post (phase 3 R3) ──────────

export async function siteNewsItemRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await newsGET(admin, kind, id, newsId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteNewsItemRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, NewsPatchSchema);
    if (!parsed.success) return parsed.response;
    return await newsPATCH(admin, kind, id, newsId, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteNewsItemRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await newsDELETE(admin, kind, id, newsId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
