import { NextRequest, NextResponse } from 'next/server';
import { getServerClient, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { MIN_PASSWORD_LENGTH } from '@/lib/supervised-credentials';

// ── POST /api/auth/change-password ────────────────────────────────────────────
// Round I: password changes move server-side (SecuritySettings used to call
// supabase.auth.updateUser client-direct) for two reasons:
//   1. updateUserById revokes the user's OTHER sessions — the change doubles
//      as the honest "sign out everywhere" (no logout-by-user-id exists in
//      this auth-js version).
//   2. A SUPERVISED athlete's password change bells their guardians
//      (visibility, not lockdown — the child keeps the ability).
// Re-auth with the current password first, the reauthenticate-route pattern.

export async function POST(request: NextRequest) {
  try {
    const supabase = getServerClient(request);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current and new password are required' },
        { status: 400 }
      );
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Brute-force surface (signInWithPassword below) — IP-keyed like reauth.
    const limited = await enforceRateLimit(request, 'reauth');
    if (limited) return limited;

    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthError) {
      return NextResponse.json({ error: 'Your current password is not correct.' }, { status: 403 });
    }

    const admin = getSupabaseAdmin();
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updateError) {
      console.error('[CHANGE-PASSWORD] update failed:', updateError);
      return NextResponse.json({ error: 'Could not update your password.' }, { status: 500 });
    }

    // Supervised athlete → bell the guardians. Best-effort.
    const { data: profile } = await admin
      .from('profiles')
      .select('supervision_state, first_name')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.supervision_state === 'supervised') {
      const { notifyGuardians } = await import('@/lib/guardian-notify');
      await notifyGuardians(admin, user.id, {
        type: 'safety_alert',
        title: `${profile.first_name || 'Your athlete'} changed their password`,
        message: 'Their other devices were signed out. Reset their login from the console if this wasn’t them.',
        actionUrl: `/app/guardian/credentials/${user.id}`,
        actorId: user.id,
      }, user.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CHANGE-PASSWORD] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
