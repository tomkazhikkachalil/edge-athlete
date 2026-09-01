import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RegistrationTransitionSchema } from '@/lib/registration/validate';
import {
  registrationTransitionPATCH,
  requireRegistrar,
} from '@/lib/orgs/registration-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/registrations/[registrationId] (phase 5 R2) ───────────
// PATCH transitions: evaluate/place/release are registrar acts (the core
// checks the verdict we pass); withdraw is the family's (self or a
// guardian acting-for, requireProfileRole-vouched) and needs no org role.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; registrationId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'registration', { userId: user.id });
    if (limited) return limited;
    const { id, registrationId } = await params;
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
    const gate = await requireRegistrar(admin, user, 'league', id);
    return await registrationTransitionPATCH(
      admin,
      user,
      'league',
      id,
      registrationId,
      parsed.data,
      { isRegistrar: gate.ok, actingFor }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[REGISTRATION] league transition error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
