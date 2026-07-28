import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import {
  isPinShaped,
  derivePinPassword,
  MIN_PASSWORD_LENGTH,
} from '@/lib/supervised-credentials';

// ── POST /api/guardian/athletes/[profileId]/credentials ───────────────────────
// Guardian issues (or resets) the child's login: username = the child's
// existing handle; secret = a password (≥6 chars) or a 4–6 digit PIN
// (PIN → HMAC-derived Supabase password; PIN login is supervised-only).
// Setting the password REVOKES the child's other sessions (Supabase
// behavior) — which is exactly what a guardian reset should do. Creates the
// supervised self-access row on first issuance. Recovery is guardian-only
// by construction: the child has no email.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const role = await getProfileRole(user.id, profileId);
    if (role !== 'guardian') {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'pin' ? 'pin' : 'password';
    const secret = typeof body.secret === 'string' ? body.secret : '';

    if (mode === 'pin') {
      if (!isPinShaped(secret)) {
        return NextResponse.json({ error: 'PIN must be 4–6 digits.' }, { status: 400 });
      }
    } else if (secret.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const { data: child } = await admin
      .from('profiles')
      .select('handle, supervision_state')
      .eq('id', profileId)
      .maybeSingle();
    if (!child || child.supervision_state !== 'supervised') {
      return NextResponse.json(
        { error: 'Credentials can only be issued for supervised profiles.' },
        { status: 400 }
      );
    }

    const actualPassword =
      mode === 'pin' ? derivePinPassword(profileId, secret) : secret;
    const { error: pwError } = await admin.auth.admin.updateUserById(profileId, {
      password: actualPassword,
    });
    if (pwError) {
      Sentry.captureException(new Error(`credentials: password set failed: ${pwError.message}`));
      return NextResponse.json({ error: 'Could not set the login. Please try again.' }, { status: 500 });
    }

    // First issuance: the supervised self-row (idempotent).
    const { error: accessError } = await admin.from('profile_access').upsert(
      { user_id: profileId, profile_id: profileId, role: 'supervised', granted_by: user.id },
      { onConflict: 'user_id,profile_id' }
    );
    if (accessError) {
      Sentry.captureException(new Error(`credentials: supervised row failed: ${accessError.message}`));
    }
    await admin.from('profile_access_audit').insert({
      profile_id: profileId,
      user_id: profileId,
      action: 'granted',
      new_role: 'supervised',
      actor_id: user.id,
    });

    return NextResponse.json({ ok: true, username: child.handle, mode });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CREDENTIALS] error:', error);
    Sentry.captureException(error, { tags: { area: 'supervised-credentials' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
