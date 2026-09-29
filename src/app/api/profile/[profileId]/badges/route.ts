import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { isMissingTableError } from '@/lib/orgs/validate';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/profile/[profileId]/badges — the badges a profile has earned
 * (the Play program, 244). The trophy case on /athlete and /u reads it.
 *
 * The profile gate is the achievements tab's: a public profile to anyone
 * (signed out too), a private one through canViewProfile (the owner, a
 * guardian, an approved follower); a departed account has no profile. A
 * refusal is the same empty list a profile with no badges gets.
 *
 * The payload is the badge key, its sport, the day, the verified mark and
 * the number that earned it — never the source row's key (it names a post
 * the viewer may not see). Viewer-dependent, so `private, no-store`.
 */
const HEADERS = { 'Cache-Control': 'private, no-store' };
const empty = () => NextResponse.json({ badges: [] }, { headers: HEADERS });

export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!profileId || !isUuid(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const admin = getSupabaseAdmin();

    if (viewerId !== profileId) {
      const { data: target } = await admin.from('profiles').select('visibility, departed_at').eq('id', profileId).maybeSingle();
      if (!target || target.departed_at) return empty();
      if (target.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) return empty();
      }
    }

    const { data, error } = await admin
      .from('badge_awards')
      .select('badge_key, sport_key, earned_on, verified, detail')
      .eq('profile_id', profileId)
      .order('earned_on', { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTableError(error.code)) return empty(); // pre-244
      reportRouteError('badges read failed:', error);
      return NextResponse.json({ error: 'Could not load badges' }, { status: 500 });
    }
    return NextResponse.json(
      {
        badges: (data ?? []).map(b => ({ key: b.badge_key, sportKey: b.sport_key, earnedOn: b.earned_on, verified: b.verified, detail: b.detail ?? {} })),
      },
      { headers: HEADERS }
    );
  } catch (error) {
    reportRouteError('GET badges error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
