import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { destinationFor, stampsOnboardingOnConfirm } from '@/lib/auth-destination';
import { COPY } from '@/lib/copy';

// ── GET /auth/confirm ─────────────────────────────────────────────────────────
// The e-mail confirmation link (Convention 56, Nov 2 2026). The Supabase
// "Confirm signup" template points here with the TOKEN HASH:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
// verifyOtp turns it into a session (the cookies are written here — the
// callback's documented exception: auth-server's client cannot set them),
// then the account goes where the OAuth callback would send it
// (destinationFor). A scout or organizer gets `onboarded_at` stamped the
// way the sign-up form did after its automatic sign-in while confirmations
// were off — their wizard IS the sign-up form.
//
// Fallbacks: a PKCE `?code=` (the default template with emailRedirectTo)
// is exchanged the callback's way; a bare visit (the implicit-flow hash the
// server never sees) goes to the sign-in page, where the browser client
// reads the hash. An expired or used link lands on the sign-in page with
// the sentence and its "Resend confirmation email" door.
const TYPES: ReadonlySet<string> = new Set(['signup', 'email', 'recovery', 'magiclink', 'invite', 'email_change']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');

  const loginWithError = (msg: string) =>
    NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, url.origin));

  if (!tokenHash && !code) {
    // The hash fragment (if any) survives the redirect; the sign-in page's client reads it.
    return NextResponse.redirect(new URL('/?signin=1', url.origin));
  }

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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  let userId: string | null = null;
  if (tokenHash) {
    if (!type || !TYPES.has(type)) return loginWithError(COPY.AUTH.CONFIRM_LINK_INVALID);
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error || !data?.user) {
      Sentry.captureMessage('auth confirm: verifyOtp failed', {
        level: 'warning',
        extra: { message: error?.message, code: error?.code, type },
      });
      return loginWithError(COPY.AUTH.CONFIRM_LINK_EXPIRED);
    }
    userId = data.user.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data?.user) {
      Sentry.captureMessage('auth confirm: code exchange failed', {
        level: 'warning',
        extra: { message: error?.message, code: error?.code },
      });
      return loginWithError(COPY.AUTH.CONFIRM_LINK_EXPIRED);
    }
    userId = data.user.id;
  }

  // A password recovery link belongs to the reset page, session in hand.
  if (type === 'recovery') return NextResponse.redirect(new URL('/reset-password', url.origin));

  let dest = destinationFor(null);
  try {
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, onboarded_at, user_type')
      .eq('id', userId!)
      .maybeSingle();
    if (profile) {
      if (!profile.onboarded_at && stampsOnboardingOnConfirm(profile.user_type)) {
        const onboarded_at = new Date().toISOString();
        const { error } = await admin.from('profiles').update({ onboarded_at }).eq('id', profile.id);
        if (!error) profile.onboarded_at = onboarded_at;
      }
      dest = destinationFor(profile);
    }
  } catch (lookupError) {
    Sentry.captureException(lookupError, { tags: { area: 'auth-confirm' } });
  }

  return NextResponse.redirect(new URL(dest, url.origin));
}
