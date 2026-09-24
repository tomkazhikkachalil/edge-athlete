// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/roster ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RosterAcceptSchema } from '@/lib/orgs/validate';
import { rosterConsentPatch, rosterDelete, rosterPatch, rosterPost, rosterSelfPost } from '@/lib/orgs/roster-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/roster — offers, accepts, declines (0.3) ──────────────
// Thin wrapper; the authorization matrix lives in orgs/roster-server.ts.

/** POST ?profileId= — a manager invites an existing member to the roster;
 *  POST { self: true } — a member counts themselves in (R3). */
export async function rosterRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'roster-offer', { userId: user.id });
    if (limited) return limited;

    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId) {
      // Onboarding v2 R3: { self: true } — a member counts themselves in.
      const body = (await request.json().catch(() => ({}))) as { self?: unknown };
      if (body.self === true) return await rosterSelfPost(getSupabaseAdmin(), user, kind, id);
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    return await rosterPost(getSupabaseAdmin(), user, kind, id, profileId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ROSTER] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { action: 'accept', profileId? } — the athlete accepts their
 *  pending offer; a guardian passes profileId to accept for their
 *  supervised athlete (0.10, requireProfileRole-gated — the followers
 *  route model). */
export async function rosterRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const parsed = await parseBody(request, RosterAcceptSchema);
    if (!parsed.success) return parsed.response;

    let actingFor: string | undefined;
    if (parsed.data.profileId && parsed.data.profileId !== user.id) {
      await requireProfileRole(request, parsed.data.profileId, 'manage_privacy');
      actingFor = parsed.data.profileId;
    }
    if (parsed.data.action === 'set_photo_consent') {
      return await rosterConsentPatch(
        getSupabaseAdmin(),
        user,
        kind,
        id,
        parsed.data.consent,
        actingFor
      );
    }
    return await rosterPatch(
      getSupabaseAdmin(),
      user,
      kind,
      id,
      actingFor,
      parsed.data.photoConsent
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ROSTER] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE [?profileId=[&as=guardian]] — self decline/leave, manager
 *  cancel/remove, or (as=guardian, 0.10) a guardian declining/leaving for
 *  their supervised athlete — requireProfileRole-gated, self-equivalent. */
export async function rosterRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }
    let guardianActing = false;
    if (searchParams.get('as') === 'guardian') {
      if (!profileId || profileId === user.id) {
        return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
      }
      await requireProfileRole(request, profileId, 'manage_privacy');
      guardianActing = true;
    }

    return await rosterDelete(getSupabaseAdmin(), user, kind, id, profileId, guardianActing);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ROSTER] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
