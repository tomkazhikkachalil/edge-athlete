// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/forms ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { FormsPatchSchema } from '@/lib/org-sites/forms';
import { formsGET, formsPATCH } from '@/lib/org-sites/forms-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/forms — the site's inbox (program 2, D2) ────────
// manage_site gates it (the same as the pages); writes ride the
// org-site-pages bucket.

export async function siteFormsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const state = request.nextUrl.searchParams.get('state') === 'archived' ? 'archived' : 'open';
    return await formsGET(admin, kind, id, state);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[SITE FORMS INBOX] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteFormsRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, FormsPatchSchema);
    if (!parsed.success) return parsed.response;
    return await formsPATCH(admin, kind, id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[SITE FORMS INBOX] ${kind} PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
