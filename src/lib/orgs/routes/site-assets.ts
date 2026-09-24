// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/assets ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { siteAssetDELETE, siteAssetPOST } from '@/lib/org-sites/pages-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/site/assets — page-image upload (phase 3 R3) ─────────
// manage_site gates it (B5: the header said manage_org); the shared 'upload' bucket meters it (pooled with
// avatar/cover/equipment on purpose).

export async function siteAssetsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
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
    // B3: a `document` part is a PDF for the documents module; `image`
    // stays the page-image/sponsor-logo shape.
    const document = formData.get('document') as File | null;
    const file = document ?? (formData.get('image') as File | null);
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    return await siteAssetPOST(admin, kind, id, file, document ? 'document' : 'image');
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE PAGES] ${kind} asset POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** B5: DELETE { path } — reclaim an asset this site uploaded and never
 *  saved. manage_site; the autosave bucket. */
export async function siteAssetsRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-draft', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const body = (await request.json().catch(() => ({}))) as { path?: unknown };
    return await siteAssetDELETE(admin, kind, id, body.path);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE ASSETS] ${kind} DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
