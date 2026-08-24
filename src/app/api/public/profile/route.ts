import { NextRequest, NextResponse } from 'next/server';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { getSportSettingsDisplay } from '@/lib/sports/settings-schemas';
import { resolveSportKey } from '@/lib/sports/resolve-sport-key';
import { buildSportStatsCard } from '@/lib/sports/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { isStatementPost } from '@/lib/statements';

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
        city,
        region,
        country,
        country_code,
        height_cm,
        weight_kg,
        weight_unit,
        dob,
        class_year,
        social_twitter,
        social_instagram,
        social_facebook,
        social_tiktok,
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

    // Fetch posts count — media-only since the statements split (074): the
    // headline number counts portfolio posts, matching the athlete pages'
    // media-only counts.all. Statements are subtracted via the PostgREST
    // null-embed (anti-join) pattern; if that count errors it degrades to
    // subtracting 0 (total count) rather than breaking the page.
    const [{ count: postsCount }, { count: statementsTotal }] = await Promise.all([
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profile.id)
        .eq('visibility', 'public'),
      supabase
        .from('posts')
        .select('id, post_media!left(id)', { count: 'exact', head: true })
        .eq('profile_id', profile.id)
        .eq('visibility', 'public')
        .is('post_media', null)
        .is('round_id', null)
        .is('group_post_id', null)
        .or('stats_data.is.null,stats_data.eq."{}"'),
    ]);

    // Fetch recent public posts. Over-fetch, then split into media posts
    // (the Recent Posts grid) and statements (the strip). Trade-off: if the
    // 24 most recent public posts are all statements, older media won't
    // backfill the grid — cosmetic on a teaser page, avoids a second query.
    const { data: rawRecentPosts } = await supabase
      .from('posts')
      .select(`
        id,
        caption,
        sport_key,
        created_at,
        likes_count,
        comments_count,
        stats_data,
        round_id,
        group_post_id,
        shared_post_id,
        post_media (
          id,
          media_url,
          media_type
        )
      `)
      .eq('profile_id', profile.id)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(24);

    // Classification fields (stats_data/round_id/group_post_id) stay server-
    // side — the wire shapes don't grow.
    const recentPosts = (rawRecentPosts || [])
      .filter(p => !isStatementPost(p))
      .slice(0, 6)
      .map(p => ({
        id: p.id,
        caption: p.caption,
        sport_key: p.sport_key,
        created_at: p.created_at,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        post_media: p.post_media,
      }));
    const statementRows = (rawRecentPosts || [])
      .filter(p => isStatementPost(p))
      .slice(0, 6);

    // Reposts on the anonymous page: hydrate a TINY quoted excerpt, and only
    // when both the original post AND its owner's profile are public — the
    // strictest read-time gate, since there is no viewer to grant more.
    // Anything else ships shared_post: null (client renders "unavailable").
    const repostOriginalIds = [...new Set(
      statementRows.map(p => p.shared_post_id).filter((id): id is string => !!id)
    )];
    const publicOriginalById = new Map<string, { author_name: string | null; caption: string | null }>();
    if (repostOriginalIds.length > 0) {
      const { data: originals } = await supabase
        .from('posts')
        .select('id, caption, visibility, profile:profile_id ( full_name, first_name, last_name, visibility )')
        .in('id', repostOriginalIds);
      for (const orig of originals || []) {
        const owner = Array.isArray(orig.profile) ? orig.profile[0] : orig.profile;
        if (orig.visibility !== 'public' || owner?.visibility !== 'public') continue;
        const authorName = owner.full_name
          || [owner.first_name, owner.last_name].filter(Boolean).join(' ')
          || null;
        publicOriginalById.set(orig.id, {
          author_name: authorName,
          caption: orig.caption ? String(orig.caption).slice(0, 140) : null,
        });
      }
    }

    const statements = statementRows.map(p => ({
      id: p.id,
      caption: p.caption,
      created_at: p.created_at,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      shared_post_id: p.shared_post_id ?? null,
      shared_post: p.shared_post_id
        ? publicOriginalById.get(p.shared_post_id) ?? null
        : null,
    }));

    // Fetch top achievements (real athlete_achievements rows — the fields
    // the pill treatment needs; podium ranking happens client-side)
    const { data: achievements } = await supabase
      .from('athlete_achievements')
      .select('id, title, placement, achieved_on')
      .eq('profile_id', profile.id)
      .order('achieved_on', { ascending: false })
      .limit(12);

    // Sport stats card — per-sport server modules (src/lib/sports/server/):
    // golf reads golf_rounds, stat-line sports aggregate public posts, and a
    // sport with neither contributes null. Generic output shape either way.
    const profileSportKey = resolveSportKey(profile.sport);
    const sportStats = await buildSportStatsCard(profileSportKey, profile.id, supabase);

    // Declared per-sport details (position, jersey, handedness, handicap...).
    // No extra privacy gate is needed: this route already 403s anything that
    // is not `visibility === 'public'`, which is exactly the agreed rule.
    // Shaped here rather than on the client so legacy keys no schema declares
    // and the empty rows onboarding writes never cross the wire.
    const { data: settingsRows } = await supabase
      .from('sport_settings')
      .select('sport_key, settings')
      .eq('profile_id', profile.id);

    const sportSettings = (settingsRows || [])
      .map(row => {
        const sportKey = row.sport_key as SportKey;
        const items = getSportSettingsDisplay(sportKey, row.settings);
        if (items.length === 0) return null;
        // Only resolve the label once the schema lookup has succeeded.
        return { sportKey, sportLabel: getSportDefinition(sportKey).display_name, items };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return NextResponse.json({
      profile: {
        ...profile,
        followersCount: followersResult.count || 0,
        followingCount: followingResult.count || 0,
        postsCount: Math.max((postsCount || 0) - (statementsTotal || 0), 0)
      },
      recentPosts,
      statements,
      achievements: achievements || [],
      // Deprecated: athlete_badges no longer render anywhere. Kept one
      // release so cached clients keep working.
      badges: [],
      sportStats,
      sportSettings,
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
