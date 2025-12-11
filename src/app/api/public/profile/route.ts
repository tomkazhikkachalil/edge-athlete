import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');

    if (!handle) {
      return NextResponse.json({ error: 'Handle is required' }, { status: 400 });
    }

    // Validate environment variables
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
        position,
        school,
        team,
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
        isPrivate: true
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
          url,
          type
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

    // Fetch golf stats if applicable
    let golfStats = null;
    if (profile.sport === 'golf' || profile.sport === 'Golf') {
      const { data: rounds } = await supabase
        .from('golf_rounds')
        .select('total_score, par')
        .eq('profile_id', profile.id)
        .order('date', { ascending: false })
        .limit(10);

      if (rounds && rounds.length > 0) {
        const scores = rounds.map(r => r.total_score).filter(Boolean);
        const avgScore = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
          : null;
        const bestScore = scores.length > 0 ? Math.min(...scores) : null;

        golfStats = {
          roundsPlayed: rounds.length,
          averageScore: avgScore,
          bestScore: bestScore
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
      golfStats
    });

  } catch (error) {
    console.error('Public profile API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
