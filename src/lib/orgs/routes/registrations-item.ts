// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/registrations/[registrationId] ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RegistrationTransitionSchema } from '@/lib/registration/validate';
import {
  registrationTransitionPATCH,
  requireRegistrar,
} from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/registrations/[registrationId] (phase 5 R2) ───────────
// PATCH transitions: evaluate/place/release are registrar acts (the core
// checks the verdict we pass); withdraw is the family's (self or a
// guardian acting-for, requireProfileRole-vouched) and needs no org role.

export async function registrationsItemRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string; registrationId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'registration', { userId: user.id });
    if (limited) return limited;
    const { id, registrationId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(registrationId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const parsed = await parseBody(request, RegistrationTransitionSchema);
    if (!parsed.success) return parsed.response;

    const admin = getSupabaseAdmin();
    let actingFor: string | undefined;
    if (parsed.data.profileId && parsed.data.profileId !== user.id) {
      await requireProfileRole(request, parsed.data.profileId, 'manage_privacy');
      actingFor = parsed.data.profileId;
    }
    // The registrar verdict rides along; withdraw ignores it, the other
    // actions require it — decided in the core, not here.
    const gate = await requireRegistrar(admin, user, kind, id);
    return await registrationTransitionPATCH(
      admin,
      user,
      kind,
      id,
      registrationId,
      parsed.data,
      { isRegistrar: gate.ok, actingFor }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[REGISTRATION] ${kind} transition error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
