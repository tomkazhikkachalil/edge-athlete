import { NextRequest, NextResponse } from 'next/server';
import { SPORT_REGISTRY, getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { getStatSchema, isStatLineData } from '@/lib/sports/stat-schemas';

/** profiles.sport stores a display label or key — resolve to a SportKey. */
function resolveSportKey(sport: string | null): SportKey | null {
  if (!sport) return null;
  const lower = sport.toLowerCase();
  if (lower in SPORT_REGISTRY) return lower as SportKey;
  const match = Object.values(SPORT_REGISTRY).find(
    def => def.display_name.toLowerCase() === lower
  );
  return match ? match.sport_key : null;
}
import { getSupabaseAdmin } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');

    if (!handle) {
      return NextResponse.json({ error: 'Handle is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Fetch profile by handle - only return public profiles
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select(`
        id,
        handle,
        first_name,
        middle_name,
        last_name,
        full_name,
        avatar_url,
        bio,
        sport,
        school,
        location,
        height_cm,
        weight_kg,
        weight_unit,
        dob,
        class_year,
        social_twitter,
        social_instagram,
        visibility,
        created_at
      `)
      .eq('handle', handle.toLowerCase())
      .single();

    if (profileError) {
      if (profileError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      console.error('Profile fetch error:', profileError);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    // Check if profile is public
    if (profile.visibility !== 'public') {
      return NextResponse.json({
        error: 'Profile is private',
        isPrivate: true,
        // The id lets the private-profile page link "Become a Fan" to
        // /athlete/<id> (that route resolves UUIDs, not handles).
        profileId: profile.id
      }, { status: 403 });
    }

    // Fetch follow stats for display
    const [followersResult, followingResult] = await Promise.all([
      supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', profile.id)
        .eq('status', 'accepted'),
      supabase
        .from('follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_id', profile.id)
        .eq('status', 'accepted')
    ]);

    // Fetch posts count
    const { count: postsCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .eq('visibility', 'public');

    // Fetch recent public posts (limited)
    const { data: recentPosts } = await supabase
      .from('posts')
      .select(`
        id,
        caption,
        sport_key,
        created_at,
        likes_count,
        comments_count,
        post_media (
          id,
          media_url,
          media_type
        )
      `)
      .eq('profile_id', profile.id)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(6);

    // Fetch badges
    const { data: badges } = await supabase
      .from('athlete_badges')
      .select('*')
      .eq('profile_id', profile.id)
      .order('position', { ascending: true });

    // Sport stats card — sport-aware (golf: rounds; stat-line sports: posts).
    // Generic shape: { label, tiles: [{label, value}] } | null.
    let sportStats: { label: string; tiles: Array<{ label: string; value: string }> } | null = null;
    const profileSportKey = resolveSportKey(profile.sport);

    if (profileSportKey === 'golf') {
      const { data: rounds } = await supabase
        .from('golf_rounds')
        .select('gross_score, par')
        .eq('profile_id', profile.id)
        .order('date', { ascending: false })
        .limit(10);

      if (rounds && rounds.length > 0) {
        const scores = rounds.map(r => r.gross_score).filter(Boolean);
        const avgScore = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
          : null;
        const bestScore = scores.length > 0 ? Math.min(...scores) : null;

        sportStats = {
          label: 'Golf Stats',
          tiles: [
            { label: 'Rounds', value: String(rounds.length) },
            { label: 'Avg Score', value: avgScore !== null ? String(avgScore) : '-' },
            { label: 'Best Score', value: bestScore !== null ? String(bestScore) : '-' },
          ],
        };
      }
    } else if (profileSportKey && getStatSchema(profileSportKey)) {
      // Stat-line sports: aggregate PUBLIC posts only (this is a public page)
      const schema = getStatSchema(profileSportKey)!;
      const { data: statPosts } = await supabase
        .from('posts')
        .select('stats_data')
        .eq('profile_id', profile.id)
        .eq('sport_key', profileSportKey)
        .eq('visibility', 'public')
        .not('stats_data', 'is', null)
        .limit(100);

      const lines = (statPosts || [])
        .map(p => p.stats_data)
        .filter(isStatLineData);

      if (lines.length > 0) {
        const totals: Record<string, number> = {};
        for (const line of lines) {
          for (const f of schema.fields) {
            const v = line.stats[f.key];
            if (typeof v === 'number' && Number.isFinite(v)) {
              totals[f.key] = (totals[f.key] ?? 0) + v;
            }
          }
        }
        const topFields = schema.fields
          .filter(f => (totals[f.key] ?? 0) > 0)
          .slice(0, 2);
        const sportDef = getSportDefinition(profileSportKey);
        sportStats = {
          label: `${sportDef.display_name} Stats`,
          tiles: [
            { label: `${schema.activityNoun}s`, value: String(lines.length) },
            ...topFields.map(f => ({ label: f.label, value: String(totals[f.key]) })),
          ].slice(0, 3),
        };
      }
    }

    return NextResponse.json({
      profile: {
        ...profile,
        followersCount: followersResult.count || 0,
        followingCount: followingResult.count || 0,
        postsCount: postsCount || 0
      },
      recentPosts: recentPosts || [],
      badges: badges || [],
      sportStats,
      // Deprecated alias — kept one release so cached clients keep working
      golfStats: null
    });

  } catch (error) {
    console.error('Public profile API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
