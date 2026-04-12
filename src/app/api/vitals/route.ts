import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';

/**
 * GET /api/vitals?profileId=xxx
 * Returns all vitals entries + training posts + athlete birthday for a profile.
 * Public profiles are visible without auth; private profiles require owner auth.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    if (!profileId) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    // Optional auth — needed for private profile access
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }

    // Check profile visibility
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, visibility, birthday')
      .eq('id', profileId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const isOwner = currentUserId === profileId;
    const isPublic = profile.visibility === 'public';

    if (!isOwner && !isPublic) {
      // Allow approved followers to view private profile vitals
      if (!currentUserId) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
      const { data: followRecord } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', currentUserId)
        .eq('following_id', profileId)
        .eq('status', 'accepted')
        .maybeSingle();
      if (!followRecord) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    // Fetch all vitals entries (immutable time-series, newest first)
    const { data: vitals, error: vitalsError } = await supabase
      .from('athlete_vitals')
      .select('*')
      .eq('profile_id', profileId)
      .order('recorded_at', { ascending: false });

    if (vitalsError) {
      console.error('Error fetching vitals:', vitalsError);
      return NextResponse.json({ error: 'Failed to fetch vitals' }, { status: 500 });
    }

    // Fetch training posts for this profile (sport_key = 'training')
    const { data: trainingPostsRaw, error: postsError } = await supabase
      .from('posts')
      .select(`
        id,
        caption,
        sport_key,
        stats_data,
        visibility,
        created_at,
        likes_count,
        comments_count,
        saves_count,
        profile:profile_id (
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          avatar_url,
          handle
        ),
        media:post_media (
          id,
          media_url,
          media_type,
          display_order
        ),
        likes:post_likes (
          profile_id
        )
      `)
      .eq('profile_id', profileId)
      .eq('sport_key', 'training')
      .order('created_at', { ascending: false })
      .limit(20);

    if (postsError) {
      console.error('Error fetching training posts:', postsError);
      // Non-fatal: return vitals even if posts fail
    }

    return NextResponse.json({
      vitals: vitals || [],
      trainingPosts: trainingPostsRaw || [],
      athleteBirthday: profile.birthday || null,
    });
  } catch (error) {
    console.error('GET /api/vitals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/vitals
 * Add a new vital entry. Entries are immutable — this always creates, never updates.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);

    const body = await request.json();
    const {
      metric_key,
      metric_category,
      metric_label,
      value,
      value_display,
      unit,
      notes,
      recorded_at,
      linked_post_id,
    } = body;

    if (!metric_key || !metric_category || !metric_label || !unit) {
      return NextResponse.json(
        { error: 'metric_key, metric_category, metric_label, and unit are required' },
        { status: 400 }
      );
    }

    if (value === null || value === undefined) {
      return NextResponse.json({ error: 'value is required' }, { status: 400 });
    }

    const numericValue = Number(value);
    if (isNaN(numericValue) || !isFinite(numericValue)) {
      return NextResponse.json({ error: 'value must be a valid number' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('athlete_vitals')
      .insert({
        profile_id: user.id,
        metric_key,
        metric_category,
        metric_label,
        value: numericValue,
        value_display: value_display || null,
        unit,
        notes: notes || null,
        recorded_at: recorded_at || new Date().toISOString().split('T')[0],
        source: 'manual',
        linked_post_id: linked_post_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting vital:', error);
      return NextResponse.json({ error: 'Failed to save vital entry' }, { status: 500 });
    }

    return NextResponse.json({ vital: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/vitals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
