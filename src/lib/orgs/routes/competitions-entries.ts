// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/competitions/entries ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { EntryAddSchema, EntryPatchSchema } from '@/lib/competitions/validate';
import { entryAddPOST, entryAffiliationPATCH, entryDecidePATCH, entryDELETE, entryPoolPATCH, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/competitions/entries — manager entry CRUD (phase 2) ───
// Thin wrapper; the competition-ownership pin (scoped: a foreign org's
// competition answers 404) and the entrant rules live in
// orgs/competition-server.ts.

export async function competitionsEntriesRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
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

    const parsed = await parseBody(request, EntryAddSchema);
    if (!parsed.success) return parsed.response;
    return await entryAddPOST(admin, parsed.data, { side: kind, orgId: id }, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} entries POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** R4: decide a pending cross-org entry (approve|reject). */
export async function competitionsEntriesRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
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

    // Track 2 PR 7: the decision on a pending entry, or a meet athlete affiliation.
    const parsed = await parseBody(request, EntryPatchSchema);
    if (!parsed.success) return parsed.response;
    if ('decision' in parsed.data) return await entryDecidePATCH(admin, parsed.data, { side: kind, orgId: id }, user.id);
    if ('pool' in parsed.data) return await entryPoolPATCH(admin, parsed.data, { side: kind, orgId: id });
    return await entryAffiliationPATCH(admin, parsed.data, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} entries PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — scoped through the competition join (no org column). */
export async function competitionsEntriesRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    if (!UUID_RE.test(id) || !entryId || !UUID_RE.test(entryId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, kind, id);
    if (!gate.ok) return gate.response;
    return await entryDELETE(admin, entryId, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[COMPETITIONS] ${kind} entries DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
