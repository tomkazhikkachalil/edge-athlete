import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { sanitizeThemePrefs } from '@/lib/theme-prefs';
import { encodeThemeCookie, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from '@/lib/theme-cookie';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PATCH /api/settings/theme — save the caller's OWN theme preference
 * (profiles.theme_prefs, migration 069). The whole body is passed through
 * sanitizeThemePrefs: unknown keys and invalid values are silently dropped,
 * so the stored JSON is always in-contract.
 *
 * Always `.eq('id', user.id)` — the theme belongs to the ACCOUNT, never to a
 * guardian-managed activeProfile, so no targetProfileId is accepted here.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid preferences body' }, { status: 400 });
    }

    const prefs = sanitizeThemePrefs(body);
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ theme_prefs: prefs })
      .eq('id', user.id);

    if (error) {
      reportRouteError('Theme prefs update error:', error);
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }

    // The device's cookie follows the account's truth from the answer itself
    // (speed round 2: the middleware no longer reads profiles.theme_prefs on
    // every document load — the client writes this cookie on change, and the
    // server's own answer agrees even if that write failed).
    const response = NextResponse.json({ prefs });
    response.cookies.set({
      name: THEME_COOKIE,
      value: encodeThemeCookie(prefs),
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false, // read by the inline head script — a display preference, not a secret
      secure: request.nextUrl.protocol === 'https:',
    });
    return response;
  } catch (error) {
    reportRouteError('Theme prefs PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
