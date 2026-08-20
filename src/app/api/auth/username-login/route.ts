import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { isPinShaped, derivePinPassword } from '@/lib/supervised-credentials';
import { enforceRateLimit } from '@/lib/rate-limit';

// ── POST /api/auth/username-login ─────────────────────────────────────────────
// Supervised-minor sign-in: username (= handle) + password-or-PIN. The route
// HARD-REJECTS non-supervised profiles, so username login never becomes a
// general path. Resolution: handle → profile (must be supervised) →
// synthetic email → server-side password grant, with session cookies set via
// the ssr adapter (same pattern as the OAuth callback). Errors are uniform
// ("Invalid username or password") — no account-existence leaks.
export async function POST(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const invalid = () =>
    NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body.username === 'string'
      ? body.username.trim().toLowerCase().replace(/^@/, '') : '';
    const secret = typeof body.secret === 'string' ? body.secret : '';
    if (!username || !secret) return invalid();

    // Two buckets: per-IP first (a distributed attacker probing MANY
    // usernames from one IP), then per-(ip,username) for the classic
    // brute-force on one account.
    const ipLimited = await enforceRateLimit(request, 'username-login-ip');
    if (ipLimited) return ipLimited;
    const limited = await enforceRateLimit(request, 'username-login', { extraKey: username });
    if (limited) return limited;

    const admin = getSupabaseAdmin();
    const { data: child } = await admin
      .from('profiles')
      .select('id, email, supervision_state')
      .ilike('handle', username)
      .maybeSingle();
    if (!child || child.supervision_state !== 'supervised' || !child.email) {
      return invalid();
    }

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

    // PIN-shaped secrets try the derived password first, then fall back to a
    // literal digit password (a guardian may have set one).
    const candidates = isPinShaped(secret)
      ? [derivePinPassword(child.id, secret), secret]
      : [secret];
    for (const password of candidates) {
      if (password.length < 6) continue;
      const { error } = await supabase.auth.signInWithPassword({
        email: child.email,
        password,
      });
      if (!error) return NextResponse.json({ ok: true });
    }
    return invalid();
  } catch (error) {
    console.error('[USERNAME-LOGIN] error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
