import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/auth-server';

// ── GET /auth/callback ────────────────────────────────────────────────────────
// OAuth (PKCE) landing: Supabase redirects here with ?code= after the
// provider round-trip. Exchange the code for a session (sets cookies), then
// route by profile state. First-time OAuth users have no profiles row —
// nothing auto-creates one (the signup trigger is disabled) — so they go to
// /auth/complete-profile to pick a handle before entering the app.
//
// NOTE: auth-server's getServerClient has no-op cookie setters and CANNOT be
// used here — the exchange must persist session cookies.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');

  const loginWithError = (msg: string) =>
    NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, url.origin));

  if (providerError) {
    const desc = url.searchParams.get('error_description') || providerError;
    return loginWithError(
      providerError === 'access_denied'
        ? 'Sign-in was cancelled.'
        : `Sign-in failed: ${desc}`
    );
  }
  if (!code) {
    return loginWithError('Sign-in failed: no authorization code returned.');
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
          // Route Handlers may write the request cookie store; Next.js
          // propagates the Set-Cookie headers onto the redirect response.
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    // Most common real-world cause: the PKCE verifier cookie is missing
    // because the flow started in a different browser context (in-app
    // webviews). Retrying from / fixes it.
    Sentry.captureMessage('oauth: code exchange failed', {
      level: 'warning',
      extra: { message: error?.message, code: error?.code },
    });
    return loginWithError('Sign-in failed. Please try again.');
  }

  let dest = '/auth/complete-profile';
  try {
    const { data: profile } = await getSupabaseAdmin()
      .from('profiles')
      .select('id, onboarded_at, user_type')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profile) {
      // Parents (097) route to the console/add-athlete, never the wizard.
      dest = profile.user_type === 'parent'
        ? (profile.onboarded_at ? '/app/guardian' : '/app/guardian/add-athlete')
        : (profile.onboarded_at ? '/athlete' : '/onboarding');
    }
  } catch (lookupError) {
    // Fall through to complete-profile — its own already-has-profile gate
    // self-corrects, and the landing page backstops the reverse case.
    Sentry.captureException(lookupError, { tags: { area: 'oauth-callback' } });
  }

  return NextResponse.redirect(new URL(dest, url.origin));
}
