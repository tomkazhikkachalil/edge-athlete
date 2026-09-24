// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/registrations ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { FEATURE_FLAGS } from '@/lib/features';
import { RegistrationCreateSchema } from '@/lib/registration/validate';
import {
  registrationCreatePOST,
  registrationsGET,
  requireRegistrar,
} from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/registrations (phase 5 R2) ────────────────────────────
// POST = the family submit (flag-gated SURFACE; every safety check in the
// core runs unconditionally); a guardian registers a supervised athlete
// via profileId, vouched with requireProfileRole — the roster route's
// acting-for recipe. GET = the registrar list (manage_registration gate)
// — the ONLY surface serving answers/medical notes.

export async function registrationsRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    if (!FEATURE_FLAGS.FEATURE_ORG_REGISTRATION) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'registration', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const parsed = await parseBody(request, RegistrationCreateSchema);
    if (!parsed.success) return parsed.response;

    let actingFor: string | undefined;
    if (parsed.data.profileId && parsed.data.profileId !== user.id) {
      await requireProfileRole(request, parsed.data.profileId, 'manage_privacy');
      actingFor = parsed.data.profileId;
    }
    return await registrationCreatePOST(
      getSupabaseAdmin(),
      user,
      kind,
      id,
      parsed.data,
      actingFor
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function registrationsRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireRegistrar(admin, user, kind, id);
    if (!gate.ok) return gate.response;
    const seasonId = new URL(request.url).searchParams.get('seasonId');
    return await registrationsGET(
      admin,
      kind,
      id,
      seasonId && UUID_RE.test(seasonId) ? seasonId : null
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
