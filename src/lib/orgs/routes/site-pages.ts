// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/pages ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { PageCreateSchema } from '@/lib/org-sites/validate';
import { pageCreatePOST, pagesGET } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/pages — page list + create (phase 3 R3) ─────────
// manage_org gates it; writes ride the org-site-pages bucket (editor
// saves must not burn the 30/h org-site budget).

export async function sitePagesRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await pagesGET(admin, kind, id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function sitePagesRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, PageCreateSchema);
    if (!parsed.success) return parsed.response;
    return await pageCreatePOST(admin, kind, id, parsed.data, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
