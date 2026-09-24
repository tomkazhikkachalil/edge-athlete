// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { SitePatchSchema } from '@/lib/org-sites/validate';
import { siteCreatePOST, siteGET, sitePATCH } from '@/lib/org-sites/server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site — the console's site CRUD (phase 3 R1) ──────────
// manage_site gates site editing; publish/unpublish (the site's existence) stay manage_org.
// POST mints the subdomain from the org name; PATCH publishes/unpublishes.
// Site Builder P2-B: content PATCHes go to the DRAFT (userId = created_by).

export async function siteRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await siteGET(admin, kind, id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITES] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id);
    if (!gate.ok) return gate.response;
    // Phase 6 R1: an optional requested slug from the slug engine —
    // absent body keeps the mint-from-name behavior.
    const body = (await request.json().catch(() => null)) as { subdomain?: unknown } | null;
    const requested = typeof body?.subdomain === 'string' ? body.subdomain : null;
    return await siteCreatePOST(admin, kind, id, gate.org.name, requested);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITES] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    // Org staff program: publish / unpublish is the org's identity act
    // (manage_org — "not the overall site"); everything else on the site
    // is the Website section.
    const parsed = await parseBody(request, SitePatchSchema);
    if (!parsed.success) return parsed.response;
    const identityAct = parsed.data.action === 'publish' || parsed.data.action === 'unpublish';
    const gate = await requireOrgManager(admin, user, kind, id, {
      intent: identityAct ? 'manage_org' : 'manage_site',
    });
    if (!gate.ok) return gate.response;
    return await sitePATCH(admin, kind, id, parsed.data, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITES] ${kind} PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
