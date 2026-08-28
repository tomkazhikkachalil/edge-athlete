import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';

/**
 * GET /api/profile/getting-started
 *
 * The signed-in user's first-run checklist state, derived entirely from
 * existing data (no new tables): has a golf round, has an avatar, how many
 * accepted follows, has any self-reported competitive level. Powers the
 * GetStartedCard on /feed for new accounts.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const [roundsRes, profileRes, followsRes, settingsRes] = await Promise.all([
      admin
        .from('golf_rounds')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id),
      admin.from('profiles').select('avatar_url').eq('id', user.id).single(),
      admin
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', user.id)
        .eq('status', 'accepted'),
      admin
        .from('sport_settings')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .not('settings->>competitive_level', 'is', null),
    ]);

    return NextResponse.json(
      {
        hasRound: (roundsRes.count ?? 0) > 0,
        hasAvatar: !!profileRes.data?.avatar_url,
        followingCount: followsRes.count ?? 0,
        hasCompetitive: (settingsRes.count ?? 0) > 0,
      },
      // Deliberately uncacheable: "I did the step, why isn't it checked?"
      // is worse than four cheap head-counts per feed load.
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('getting-started GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
