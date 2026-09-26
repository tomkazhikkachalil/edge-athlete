// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/pages/[pageId] ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { PagePatchSchema } from '@/lib/org-sites/validate';
import { pageDELETE, pageGET, pagePATCH } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { recordAuthority } from '@/lib/authority/audit-server';

// ── /api/{leagues,clubs}/[id]/site/pages/[pageId] — one page (phase 3 R3) ──────────

export async function sitePagesItemRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; pageId: string }) {
  try {
    const user = await requireAuth(request);
    const { id, pageId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await pageGET(admin, kind, id, pageId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} page GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function sitePagesItemRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string; pageId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, pageId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, PagePatchSchema);
    if (!parsed.success) return parsed.response;
    return await pagePATCH(admin, kind, id, pageId, parsed.data, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} page PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function sitePagesItemRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string; pageId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, pageId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(pageId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const res = await pageDELETE(admin, kind, id, pageId, user.id);
    if (res.ok) {
      await recordAuthority(admin, {
        subject: { type: 'org', id },
        actor: { kind: 'member', profileId: user.id },
        action: 'page_removed',
        detail: { page_id: pageId },
      });
    }
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} page DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
