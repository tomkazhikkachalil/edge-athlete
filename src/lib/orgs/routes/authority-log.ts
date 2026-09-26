// ── One handler for both kinds: /api/{leagues,clubs}/[id]/authority-log (Authority PR 5) ──
// The owner's Activity: who changed who can run the org and its public face.
// OWNERS only (the 'change_roles' intent — the same people who change roles).
// `?before=<iso>` pages back. The projection never names the Edge Athlete admin.
import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/uuid';
import { readOwnerAuthorityLog } from '@/lib/authority/log-server';
import { reportRouteError } from '@/lib/observability/report';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function authorityLogRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, params.id, { intent: 'change_roles' });
    if (!gate.ok) return gate.response;
    const raw = request.nextUrl.searchParams.get('before');
    const before = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
    const log = await readOwnerAuthorityLog(admin, params.id, before);
    return NextResponse.json(log, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[AUTHORITY LOG] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
