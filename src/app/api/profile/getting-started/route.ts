import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/profile/getting-started
 *
 * The signed-in user's first-run checklist state, derived entirely from
 * existing data (no new tables): has a first activity (a golf round or a
 * stat-line post — any sport, Round 4), has an avatar, how many accepted
 * follows, has any self-reported competitive level. Powers the
 * GetStartedCard on /feed for new accounts.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const [roundsRes, statLineRes, profileRes, settingsRes] = await Promise.all([
      // "Has at least one" — a LIMIT 1 read, never an exact count of
      // everything (Round 3: four COUNT(*) per app-shell load before).
      admin
        .from('golf_rounds')
        .select('id')
        .eq('profile_id', user.id)
        .limit(1),
      // Round 4: a stat-line post counts too — a hockey player's first game
      // used to leave "Log your first round" unchecked forever.
      admin
        .from('posts')
        .select('id')
        .eq('profile_id', user.id)
        .not('stats_data', 'is', null)
        .limit(1),
      // The checklist shows "2/3": the trigger-maintained column (229).
      admin.from('profiles').select('avatar_url, following_count').eq('id', user.id).single(),
      admin
        .from('sport_settings')
        .select('id')
        .eq('profile_id', user.id)
        .not('settings->>competitive_level', 'is', null)
        .limit(1),
    ]);

    return NextResponse.json(
      {
        // `hasActivity` since Round 4 (a round OR a stat line); `hasRound` kept for old clients.
        hasActivity: (roundsRes.data?.length ?? 0) > 0 || (statLineRes.data?.length ?? 0) > 0,
        hasRound: (roundsRes.data?.length ?? 0) > 0,
        hasAvatar: !!profileRes.data?.avatar_url,
        followingCount: (profileRes.data as { following_count?: number | null } | null)?.following_count ?? 0,
        hasCompetitive: (settingsRes.data?.length ?? 0) > 0,
      },
      // Deliberately uncacheable: "I did the step, why isn't it checked?"
      // is worse than three cheap reads per feed load.
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('getting-started GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
