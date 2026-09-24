// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/structure/entries ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { EntryCreateSchema } from '@/lib/structure/validate';
import { requireOrgManager, entryCreatePOST, entryDELETE } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/structure/entries — manager placements (phase 1) ─────
// Scoped: foreign teams/divisions answer 404; the cross-org and
// archived-team rules live in the shared lib.

export async function structureEntriesRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    // Org staff program: the division comes from the body, so parse first —
    // a grant on that division (or org-wide Teams) is enough.
    const parsed = await parseBody(request, EntryCreateSchema);
    if (!parsed.success) return parsed.response;
    const gate = await requireOrgManager(admin, user, kind, id, {
      intent: 'manage_teams',
      scope: { type: 'division', id: parsed.data.divisionId },
    });
    if (!gate.ok) return gate.response;
    return await entryCreatePOST(admin, parsed.data, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] entries POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — withdraw an entry (verified through the division join). */
export async function structureEntriesRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    if (!UUID_RE.test(id) || !entryId || !UUID_RE.test(entryId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    // The entry's division is the scope (entryDELETE re-verifies the join).
    const { data: entryRow } = await admin
      .from('team_entries')
      .select('division_id')
      .eq('id', entryId)
      .maybeSingle();
    const gate = await requireOrgManager(admin, user, kind, id, {
      intent: 'manage_teams',
      ...(entryRow?.division_id ? { scope: { type: 'division', id: entryRow.division_id as string } } : {}),
    });
    if (!gate.ok) return gate.response;
    return await entryDELETE(admin, entryId, { side: kind, orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG STRUCTURE] entries DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
