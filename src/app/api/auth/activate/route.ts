import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { redeemGuardianInvite } from '@/lib/guardian-invites';
import { loginRateLimiter } from '@/lib/rate-limit';

// ── POST /api/auth/activate ───────────────────────────────────────────────────
// Post-transfer account activation: the new owner consumes their single-use
// athlete_activation token, sets a password, and is signed in — in one call.
// Redeem happens BEFORE the password set on purpose: a burned token still
// leaves /forgot-password on the (already-live) new email, never a lockout.

export async function POST(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (token.length < 20) {
      return NextResponse.json({ error: 'Invalid activation link.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      );
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!loginRateLimiter.check(ip, 'activate').allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a few minutes.' },
        { status: 429 }
      );
    }

    const admin = getSupabaseAdmin();
    const invite = await redeemGuardianInvite(admin, token, 'athlete_activation');
    if (!invite || !invite.profile_id) {
      return NextResponse.json(
        { error: 'This link has expired or was already used.' },
        { status: 410 }
      );
    }
    const profileId = invite.profile_id;

    const { error: pwError } = await admin.auth.admin.updateUserById(profileId, { password });
    if (pwError) {
      // Token is burned, but /forgot-password on the new email still works.
      Sentry.captureException(new Error(`activate: password set failed: ${pwError.message}`), {
        extra: { profileId },
      });
      return NextResponse.json(
        { error: 'Could not set your password. Please use the password reset instead.' },
        { status: 500 }
      );
    }

    // The profile was guardian-created and never onboarded — stamp it so the
    // new owner lands on their profile, not the generic onboarding flow.
    await admin
      .from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', profileId)
      .is('onboarded_at', null);

    // What the former guardian can see now — chosen by the athlete during
    // the transfer's dual-confirm step; shown on the review screen.
    const { data: completed } = await admin
      .from('profile_transfers')
      .select('guardian_post_role')
      .eq('profile_id', profileId)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Sign the new owner in (ssr cookie adapter — OAuth-callback pattern).
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: invite.invited_email,
      password,
    });

    return NextResponse.json({
      ok: true,
      profileId,
      guardianAccess: completed?.guardian_post_role ?? null,
      signedIn: !signInError,
    });
  } catch (error) {
    console.error('[ACTIVATE] error:', error);
    Sentry.captureException(error, { tags: { area: 'transfers' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
