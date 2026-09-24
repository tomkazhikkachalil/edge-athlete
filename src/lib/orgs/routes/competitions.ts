// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/competitions ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { CompetitionCreateSchema, CompetitionPatchSchema } from '@/lib/competitions/validate';
import {
  competitionCreatePOST,
  competitionPATCH,
  competitionsAggregateGET,
  requireCompetitionManager,
} from '@/lib/orgs/competition-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/competitions — manager competition CRUD (phase 2) ─────
// Thin wrapper; gate + rules in orgs/competition-server.ts. The body/URL
// mismatch guard runs BEFORE the lib call. No DELETE — archive is the
// manager affordance (the teams recipe); hard delete stays admin.

export async function competitionsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, kind, id);
    if (!gate.ok) return gate.response;
    return await competitionsAggregateGET(admin, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function competitionsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, kind, id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, CompetitionCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.side !== kind || parsed.data.orgId !== id) {
      return NextResponse.json({ error: 'Body organization does not match the URL' }, { status: 400 });
    }
    if (!isSportEnabled(parsed.data.sportKey as SportKey)) {
      return NextResponse.json(
        { error: `Unknown or disabled sport: ${parsed.data.sportKey}` },
        { status: 400 }
      );
    }
    return await competitionCreatePOST(admin, { side: kind, orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function competitionsRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, kind, id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, CompetitionPatchSchema);
    if (!parsed.success) return parsed.response;
    return await competitionPATCH(admin, parsed.data, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
