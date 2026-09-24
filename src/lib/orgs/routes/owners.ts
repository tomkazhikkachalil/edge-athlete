// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/owners ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { promoteToOwner, stepDownAsOwner } from '@/lib/orgs/owners';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/owners — co-owner minting + self step-down (0.8) ──────
// Thin wrapper; the matrix lives in orgs/owners.ts. Transfer = promote,
// then the old owner steps down.

/** POST ?profileId= — an owner promotes a member/manager to co-owner. */
export async function ownersRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'owner-change', { userId: user.id });
    if (limited) return limited;

    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    return await promoteToOwner(getSupabaseAdmin(), user, kind, id, profileId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG OWNERS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE — the caller steps down. A foreign profileId is refused loudly:
 *  owners never remove each other (the no-coup contract). */
export async function ownersRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'owner-change', { userId: user.id });
    if (limited) return limited;

    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && profileId !== user.id) {
      return NextResponse.json(
        { error: "Owners can't remove each other — owners only step down themselves" },
        { status: 400 }
      );
    }

    return await stepDownAsOwner(getSupabaseAdmin(), user, kind, id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG OWNERS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
