// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/preview ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { signPreviewToken } from '@/lib/org-sites/preview-token';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { ORG_ID, ORG_LABEL, type OrgKind } from '@/lib/orgs/org-ref';

// ── /api/{leagues,clubs}/[id]/site/preview — mint a draft-preview link ─────────────
// manage_site gates the mint (B5: the header said manage_org); the signed short-lived token then carries
// the authorization into the session-free public segment.

export async function sitePreviewRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain')
      .eq(ORG_ID, id)
      .maybeSingle();
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }
    const token = signPreviewToken(site.id);
    return NextResponse.json({ url: `/org/${site.subdomain}/preview/${token}` });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PREVIEW] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
