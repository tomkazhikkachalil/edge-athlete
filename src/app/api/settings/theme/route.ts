import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { sanitizeThemePrefs } from '@/lib/theme-prefs';

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
      console.error('Theme prefs update error:', error);
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({ prefs });
  } catch (error) {
    console.error('Theme prefs PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
