import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication (Next.js 15 pattern)
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

/**
 * POST /api/golf/scorecards
 * Create golf scorecard data for a group post
 * Body:
 *   - group_post_id: UUID (required)
 *   - course_name: string (required)
 *   - course_id: UUID (optional)
 *   - round_type: 'outdoor' | 'indoor' (required)
 *   - holes_played: number (required, 1-18)
 *   - tee_color: string (optional, for outdoor)
 *   - slope_rating: number (optional, for outdoor)
 *   - course_rating: number (optional, for outdoor)
 *   - weather_conditions: string (optional, for outdoor)
 *   - temperature: number (optional, for outdoor)
 *   - wind_speed: number (optional, for outdoor)
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      group_post_id,
      course_name,
      course_id,
      round_type,
      holes_played,
      tee_color,
      slope_rating,
      course_rating,
      weather_conditions,
      temperature,
      wind_speed,
    } = body;

    // Validate required fields
    if (!group_post_id || !course_name || !round_type || !holes_played) {
      return NextResponse.json(
        { error: 'Missing required fields: group_post_id, course_name, round_type, holes_played' },
        { status: 400 }
      );
    }

    // Validate round_type
    if (!['outdoor', 'indoor'].includes(round_type)) {
      return NextResponse.json(
        { error: 'round_type must be "outdoor" or "indoor"' },
        { status: 400 }
      );
    }

    // Validate holes_played
    if (holes_played < 1 || holes_played > 18) {
      return NextResponse.json(
        { error: 'holes_played must be between 1 and 18' },
        { status: 400 }
      );
    }

    // Verify user is the creator of the group post
    const { data: groupPost, error: groupPostError } = await supabase
      .from('group_posts')
      .select('creator_id, type')
      .eq('id', group_post_id)
      .single();

    if (groupPostError || !groupPost) {
      return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
    }

    if (groupPost.creator_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the creator can add golf scorecard data' },
        { status: 403 }
      );
    }

    if (groupPost.type !== 'golf_round') {
      return NextResponse.json(
        { error: 'Group post type must be "golf_round" to add golf data' },
        { status: 400 }
      );
    }

    // Create golf scorecard data
    const { data: golfData, error: insertError } = await supabase
      .from('golf_scorecard_data')
      .insert({
        group_post_id,
        course_name,
        course_id,
        round_type,
        holes_played,
        tee_color,
        slope_rating,
        course_rating,
        weather_conditions,
        temperature,
        wind_speed,
      })
      .select()
      .single();

    if (insertError) {
      // Check if already exists
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Golf scorecard data already exists for this group post' },
          { status: 409 }
        );
      }
      console.error('Error creating golf scorecard data:', insertError);
      return NextResponse.json({ error: 'Failed to create golf scorecard data' }, { status: 500 });
    }

    return NextResponse.json({
      golf_data: golfData,
      message: 'Golf scorecard data created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/golf/scorecards:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/golf/scorecards?group_post_id=xxx
 * Fetch golf scorecard data for a group post
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const group_post_id = searchParams.get('group_post_id');

    if (!group_post_id) {
      return NextResponse.json(
        { error: 'group_post_id query parameter is required' },
        { status: 400 }
      );
    }

    // Fetch golf data - RLS handles access control
    const { data: golfData, error: fetchError } = await supabase
      .from('golf_scorecard_data')
      .select('*')
      .eq('group_post_id', group_post_id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Golf scorecard data not found' }, { status: 404 });
      }
      console.error('Error fetching golf scorecard data:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch golf scorecard data' }, { status: 500 });
    }

    return NextResponse.json({ golf_data: golfData });
  } catch (error) {
    console.error('Unexpected error in GET /api/golf/scorecards:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
