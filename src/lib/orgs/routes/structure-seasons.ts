// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/structure/seasons ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { SeasonCreateSchema } from '@/lib/structure/validate';
import { requireOrgManager, seasonCreatePOST, seasonDELETE } from '@/lib/orgs/structure-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/structure/seasons — manager season CRUD (phase 1) ────
// Thin wrapper; gate + rules in orgs/structure-server.ts. The body/URL
// mismatch guard runs BEFORE the lib call — the gate authorizes the URL
// org, so the write must never land in a body-supplied other org.

export async function structureSeasonsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_structure' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, SeasonCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.side !== kind || parsed.data.orgId !== id) {
      return NextResponse.json({ error: 'Body organization does not match the URL' }, { status: 400 });
    }
    if (parsed.data.sportKey && !isSportEnabled(parsed.data.sportKey as SportKey)) {
      return NextResponse.json(
        { error: `Unknown or disabled sport: ${parsed.data.sportKey}` },
        { status: 400 }
      );
    }
    return await seasonCreatePOST(admin, { side: kind, orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] seasons POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — scoped to this org (a foreign season answers 404). */
export async function structureSeasonsRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('id');
    if (!UUID_RE.test(id) || !seasonId || !UUID_RE.test(seasonId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_structure' });
    if (!gate.ok) return gate.response;
    return await seasonDELETE(admin, seasonId, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] seasons DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
