// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/logo ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { siteLogoDELETE, siteLogoPOST } from '@/lib/org-sites/logo-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/logo — org site logo (phase 3 R3) ───────────────
// manage_org gates it; the shared core clones the cover-upload recipe.

export async function siteLogoRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const formData = await request.formData();
    const file = formData.get('logo') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    return await siteLogoPOST(admin, kind, id, file);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE LOGO] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteLogoRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await siteLogoDELETE(admin, kind, id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE LOGO] ${kind} DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
