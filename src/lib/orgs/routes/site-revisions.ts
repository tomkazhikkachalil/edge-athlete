// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/revisions ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RevisionActionSchema } from '@/lib/org-sites/validate';
import { revisionsGET, revisionsPOST } from '@/lib/org-sites/revisions-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/revisions — draft / publish / history (Site Builder
// phase 2, mig 180). GET lists the revisions + the draft's state; POST is one
// action union: publish (promote the draft, optional label), discard,
// restore {revisionId} (into the draft), label {revisionId, label}. All
// `manage_site` — the Website section's staff already write live content
// today (Tom, Sep 9 2026); taking the site live/offline stays `manage_org`
// on the site route. Pre-180: GET answers `supported: false`, POST 409.

export async function siteRevisionsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await revisionsGET(admin, kind, id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE REVISIONS] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteRevisionsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-revisions', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const parsed = await parseBody(request, RevisionActionSchema);
    if (!parsed.success) return parsed.response;
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await revisionsPOST(admin, kind, id, user.id, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE REVISIONS] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
