import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { reportRouteError } from '@/lib/observability/report';
import { isActivityType } from '@/lib/activities/catalog';
import { answersOf, prefillFrom } from '@/lib/activities/details';

/**
 * GET /api/activities/last-details?type=swim[&targetProfileId=…] — the
 * Finish sheet's starting answers (activities details, Oct 16 2026): the
 * CHOICES and yes/no answers of the acting profile's last activity of that
 * type with any answers (details.ts prefillFrom — a number never carries
 * over). Read on the server so it follows the athlete across devices.
 * Viewer-dependent → `private, no-store`. 200 { details } ({} when none).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const params = request.nextUrl.searchParams;
    const type = params.get('type');
    if (!isActivityType(type)) return NextResponse.json({ error: 'Unknown activity type' }, { status: 400, headers: NO_STORE });
    const target = params.get('targetProfileId');
    const gate = await resolveActingProfile(user.id, target || null, 'Only a guardian may read this profile’s activities.');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: NO_STORE });
    const { data, error } = await getSupabaseAdmin()
      .from('activities')
      .select('details, sport_key, session_kind')
      .eq('profile_id', gate.actorId)
      .eq('activity_type', type)
      // A sport session's answers are its columns (A9); every other type's are details.
      .not(type === 'sport_session' ? 'sport_key' : 'details', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      reportRouteError('[activities/last-details] read failed:', error);
      return NextResponse.json({ error: 'Could not read your last answers.' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ details: data ? prefillFrom(type, answersOf(type, data)) : {} }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/last-details] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
