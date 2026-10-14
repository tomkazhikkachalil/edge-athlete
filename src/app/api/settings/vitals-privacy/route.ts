import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseTrainingPrivacy } from '@/lib/training-privacy';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PATCH /api/settings/vitals-privacy — save the caller's OWN training privacy
 * privacy (profiles.vitals_privacy, migration 122). The whole body passes
 * through parseTrainingPrivacy: unknown keys and invalid values are silently
 * dropped, so the stored JSON is always in-contract (the theme_prefs
 * route's pattern).
 *
 * Always `.eq('id', user.id)` — privacy over one's own data belongs to the
 * account; no targetProfileId is accepted here.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid privacy body' }, { status: 400 });
    }

    const privacy = parseTrainingPrivacy(body);
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ vitals_privacy: privacy })
      .eq('id', user.id);

    if (error) {
      reportRouteError('Training privacy update error:', error);
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({ trainingPrivacy: privacy });
  } catch (error) {
    reportRouteError('Training privacy PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
