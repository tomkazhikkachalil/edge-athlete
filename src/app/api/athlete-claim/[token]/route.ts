import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  peekAthleteClaimInvite,
  redeemAthleteClaimInvite,
  restoreAthleteClaimInvite,
} from '@/lib/athlete-claim';
import { makeSyntheticEmail } from '@/lib/config/minors-config';

// ── /api/athlete-claim/[token] — stub-athlete handover (phase 1 R3) ─────────
// GET = unauthenticated peek (uniform {valid:false} 404s; never the email).
// POST mode 'self' = the ACCOUNTLESS adult claim: no merge machinery
// exists, so "this is me" activates the stub AS your account — real email
// + password onto the shadow auth user, supervised self row flips to
// owner (the transfers.ts same-row transition), then the inline cookie
// sign-in. This route joins the documented createServerClient+cookies
// exception list in src/app/api/CLAUDE.md.
// POST mode 'guardian' = signed-in: grant_guardian_access, then DELETE the
// stub's supervised self row (it is the app-wide "has login" marker — kept,
// it would suppress the credentials_gap queue item), re-key the shadow
// email to @minors.invalid (restores digest→guardian routing; the
// @stubs.invalid ⇔ unclaimed invariant ends here). Roster rows stay
// ACTIVE either way — the claim is the consent act (Tom, R3).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'athlete-claim-peek');
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) {
      return NextResponse.json({ valid: false }, { status: 404 });
    }
    const peeked = await peekAthleteClaimInvite(getSupabaseAdmin(), token);
    if (!peeked) return NextResponse.json({ valid: false }, { status: 404 });
    return NextResponse.json({
      valid: true,
      athleteName: peeked.athleteName,
      orgName: peeked.orgName,
      teamName: peeked.teamName,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ATHLETE CLAIM] peek error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'athlete-claim');
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'This link is not valid' }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string;
      email?: string;
      password?: string;
    };
    const admin = getSupabaseAdmin();

    // Preconditions WITHOUT consuming (peek answers null once claimed).
    const peeked = await peekAthleteClaimInvite(admin, token);
    if (!peeked) {
      return NextResponse.json(
        { error: 'This link has expired or was already used.' },
        { status: 410 }
      );
    }

    if (body.mode === 'self') {
      const email = (body.email ?? '').trim().toLowerCase();
      const password = body.password ?? '';
      if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) {
        return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json(
          { error: 'Password must be at least 6 characters' },
          { status: 400 }
        );
      }

      const redeemed = await redeemAthleteClaimInvite(admin, token, null);
      if (!redeemed) {
        return NextResponse.json(
          { error: 'This link has expired or was already used.' },
          { status: 410 }
        );
      }
      const profileId = redeemed.profileId;

      // Real email onto the shadow user (transfers set_email step). ANY
      // failure restores the invite; the collision shape gets its own 409.
      const { error: emailError } = await admin.auth.admin.updateUserById(profileId, {
        email,
        email_confirm: true,
      });
      if (emailError) {
        await restoreAthleteClaimInvite(admin, token);
        if (/already|registered|exists/i.test(emailError.message)) {
          return NextResponse.json(
            {
              error:
                'That email already has an Edge Athlete account. Sign in with it and ask the organization for a guardian link, or contact support.',
            },
            { status: 409 }
          );
        }
        console.error('[ATHLETE CLAIM] email set failed:', emailError);
        return NextResponse.json({ error: 'Could not complete the claim' }, { status: 500 });
      }
      await admin.from('profiles').update({ email }).eq('id', profileId);

      // Password AFTER the redeem+email: a failure here leaves a burned
      // token but a LIVE email — the activate philosophy; password reset
      // is the recovery path.
      const { error: passwordError } = await admin.auth.admin.updateUserById(profileId, {
        password,
      });
      if (passwordError) {
        console.error('[ATHLETE CLAIM] password set failed:', passwordError);
        return NextResponse.json(
          { error: 'Your email is set but the password failed — use "Forgot password" to finish.' },
          { status: 500 }
        );
      }

      // The self-row flip (supervised → owner, same row — 048-legal) + the
      // profile's coming-of-age.
      await admin
        .from('profile_access')
        .update({ role: 'owner' })
        .eq('user_id', profileId)
        .eq('profile_id', profileId)
        .eq('role', 'supervised');
      await admin.from('profile_access_audit').insert({
        profile_id: profileId,
        user_id: profileId,
        action: 'role_changed',
        old_role: 'supervised',
        new_role: 'owner',
        actor_id: profileId,
      });
      await admin.from('profiles').update({ supervision_state: 'self' }).eq('id', profileId);
      // Coming of age skips onboarding's stamp — set it if never set.
      await admin
        .from('profiles')
        .update({ onboarded_at: new Date().toISOString() })
        .eq('id', profileId)
        .is('onboarded_at', null);

      // Inline cookie sign-in (the documented exception — this route must
      // SET session cookies, which the shared helper structurally can't).
      let signedIn = false;
      try {
        const cookieStore = await cookies();
        const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return cookieStore.getAll();
              },
              setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options)
                );
              },
            },
          }
        );
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        signedIn = !signInError;
      } catch (e) {
        console.error('[ATHLETE CLAIM] sign-in failed:', e);
      }

      return NextResponse.json({ ok: true, mode: 'self', profileId, signedIn });
    }

    if (body.mode === 'guardian') {
      const { user } = await getServerAuth(request);
      if (!user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      if (user.id === peeked.profileId) {
        return NextResponse.json({ error: 'You cannot guardian your own profile' }, { status: 400 });
      }
      // Route-layer cap re-checks (the invites-claim pattern: the RPC's
      // RAISE is never the user-facing error).
      const { data: existing } = await admin
        .from('profile_access')
        .select('role')
        .eq('profile_id', peeked.profileId)
        .neq('user_id', peeked.profileId);
      if ((existing ?? []).length >= 2) {
        return NextResponse.json(
          { error: 'This athlete already has the maximum number of guardians' },
          { status: 409 }
        );
      }
      const { data: mine } = await admin
        .from('profile_access')
        .select('id')
        .eq('profile_id', peeked.profileId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (mine) {
        return NextResponse.json({ error: 'You already have access to this athlete' }, { status: 409 });
      }

      const redeemed = await redeemAthleteClaimInvite(admin, token, user.id);
      if (!redeemed) {
        return NextResponse.json(
          { error: 'This link has expired or was already used.' },
          { status: 410 }
        );
      }
      const profileId = redeemed.profileId;

      const { error: grantError } = await admin.rpc('grant_guardian_access', {
        p_profile: profileId,
        p_new_guardian: user.id,
        p_actor: user.id,
      });
      if (grantError) {
        console.error('[ATHLETE CLAIM] guardian grant failed:', grantError);
        await restoreAthleteClaimInvite(admin, token);
        return NextResponse.json({ error: 'Could not complete the claim' }, { status: 500 });
      }

      // DELETE the supervised self row: it is the "has login" marker, and
      // keeping it would suppress the credentials_gap queue item. The
      // guardian row exists, so 048's deferred zero-access trigger passes;
      // first credential issuance recreates the self row.
      await admin
        .from('profile_access')
        .delete()
        .eq('user_id', profileId)
        .eq('profile_id', profileId)
        .eq('role', 'supervised');
      await admin.from('profile_access_audit').insert({
        profile_id: profileId,
        user_id: profileId,
        action: 'revoked',
        old_role: 'supervised',
        actor_id: user.id,
      });

      // @stubs.invalid ⇔ unclaimed ends here: re-key to @minors.invalid so
      // the supervised-minor machinery (digest→guardian routing, urgent
      // synthetic flag) takes over.
      const syntheticEmail = makeSyntheticEmail(profileId);
      await admin.auth.admin.updateUserById(profileId, {
        email: syntheticEmail,
        email_confirm: true,
      });
      await admin.from('profiles').update({ email: syntheticEmail }).eq('id', profileId);
      await admin
        .from('notification_preferences')
        .upsert({ user_id: profileId, email_enabled: true }, { onConflict: 'user_id' });

      return NextResponse.json({ ok: true, mode: 'guardian', profileId });
    }

    return NextResponse.json({ error: 'Unknown claim mode' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ATHLETE CLAIM] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
