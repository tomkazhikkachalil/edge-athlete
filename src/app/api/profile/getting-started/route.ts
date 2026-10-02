import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { DISMISSED_META_KEY, isDismissedInMetadata } from '@/lib/get-started';

/**
 * GET /api/profile/getting-started
 *
 * The signed-in user's first-run checklist state, derived entirely from
 * existing data (no new tables): has a first activity (a golf round or a
 * stat-line post — any sport, Round 4), has an avatar, how many accepted
 * follows, has any self-reported competitive level. Powers the
 * GetStartedCard on /feed for new accounts.
 *
 * `dismissed` (Oct 2026): the card's X is remembered on the ACCOUNT — the
 * auth user's metadata, read fresh here (a session's own copy is as old as
 * its token) — so it stays closed on every device, in a private window and
 * in the app installed from the home screen. POST { dismiss: true } stamps it.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    const [roundsRes, statLineRes, profileRes, settingsRes, accountRes] = await Promise.all([
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
      admin.auth.admin.getUserById(user.id),
    ]);

    return NextResponse.json(
      {
        // `hasActivity` since Round 4 (a round OR a stat line); `hasRound` kept for old clients.
        hasActivity: (roundsRes.data?.length ?? 0) > 0 || (statLineRes.data?.length ?? 0) > 0,
        hasRound: (roundsRes.data?.length ?? 0) > 0,
        hasAvatar: !!profileRes.data?.avatar_url,
        followingCount: (profileRes.data as { following_count?: number | null } | null)?.following_count ?? 0,
        hasCompetitive: (settingsRes.data?.length ?? 0) > 0,
        dismissed: isDismissedInMetadata(accountRes.data?.user?.user_metadata),
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

/**
 * POST /api/profile/getting-started { dismiss: true }
 *
 * The signed-in account closed the card. Stamped on the auth user's metadata
 * with the admin client (existing keys kept) — the account's own, nobody
 * else's, and idempotent: a second close keeps the first stamp.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as { dismiss?: unknown } | null;
    if (!body || body.dismiss !== true) {
      return NextResponse.json({ error: 'Send { "dismiss": true }' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: account, error: readError } = await admin.auth.admin.getUserById(user.id);
    if (readError || !account?.user) {
      reportRouteError('getting-started POST read error:', readError);
      return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
    }
    const metadata = (account.user.user_metadata ?? {}) as Record<string, unknown>;
    if (!isDismissedInMetadata(metadata)) {
      const { error: writeError } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...metadata, [DISMISSED_META_KEY]: new Date().toISOString() },
      });
      if (writeError) {
        reportRouteError('getting-started POST write error:', writeError);
        return NextResponse.json({ error: 'Could not save that' }, { status: 500 });
      }
    }
    return NextResponse.json({ dismissed: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('getting-started POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
