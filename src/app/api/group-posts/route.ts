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
 * GET /api/group-posts
 * Fetch group posts for the authenticated user (created or participating)
 * Query params:
 *   - type: Filter by activity type (golf_round, hockey_game, etc.)
 *   - status: Filter by status (pending, active, completed, cancelled)
 *   - limit: Number of results (default 20)
 *   - cursor: Pagination cursor (created_at timestamp)
 */
export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse query parameters
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const cursor = searchParams.get('cursor');

  try {
    // Build query - RLS will filter to user's accessible posts
    let query = supabase
      .from('group_posts')
      .select(`
        *,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        participants:group_post_participants (
          id,
          profile_id,
          status,
          role,
          attested_at,
          data_contributed
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Apply filters
    if (type) {
      query = query.eq('type', type);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    const { data: groupPosts, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching group posts:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch group posts' }, { status: 500 });
    }

    return NextResponse.json({
      group_posts: groupPosts || [],
      has_more: groupPosts && groupPosts.length === limit,
      next_cursor: groupPosts && groupPosts.length > 0
        ? groupPosts[groupPosts.length - 1].created_at
        : null,
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/group-posts
 * Create a new group post
 * Body:
 *   - type: Activity type (required)
 *   - title: Title (required)
 *   - description: Description (optional)
 *   - date: Date of activity (required)
 *   - location: Location (optional)
 *   - visibility: public | private | participants_only (default: public)
 *   - participant_ids: Array of profile IDs to invite (optional)
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
    const { type, title, description, date, location, visibility, participant_ids } = body;

    // Validate required fields
    if (!type || !title || !date) {
      return NextResponse.json(
        { error: 'Missing required fields: type, title, date' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = [
      'golf_round',
      'hockey_game',
      'volleyball_match',
      'basketball_game',
      'social_event',
      'practice_session',
      'tournament_round',
      'watch_party',
    ];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Create group post
    const { data: groupPost, error: createError } = await supabase
      .from('group_posts')
      .insert({
        creator_id: user.id,
        type,
        title,
        description,
        date,
        location,
        visibility: visibility || 'public',
        status: 'pending', // Start as pending/draft
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating group post:', createError);
      return NextResponse.json({ error: 'Failed to create group post' }, { status: 500 });
    }

    // Add creator as participant with 'creator' role
    const { error: creatorError } = await supabase
      .from('group_post_participants')
      .insert({
        group_post_id: groupPost.id,
        profile_id: user.id,
        role: 'creator',
        status: 'confirmed', // Creator is auto-confirmed
        attested_at: new Date().toISOString(),
      });

    if (creatorError) {
      console.error('Error adding creator as participant:', creatorError);
      // Non-fatal - group post still created
    }

    // Add invited participants if provided
    if (participant_ids && Array.isArray(participant_ids) && participant_ids.length > 0) {
      const participantInserts = participant_ids.map((profile_id: string) => ({
        group_post_id: groupPost.id,
        profile_id,
        role: 'participant',
        status: 'pending', // Invited participants start as pending
      }));

      const { error: participantsError } = await supabase
        .from('group_post_participants')
        .insert(participantInserts);

      if (participantsError) {
        console.error('Error adding participants:', participantsError);
        // Non-fatal - group post and creator still created
      }
    }

    // Fetch complete group post with participants
    const { data: completeGroupPost } = await supabase
      .from('group_posts')
      .select(`
        *,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        participants:group_post_participants (
          id,
          profile_id,
          status,
          role,
          attested_at,
          profile:profile_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url,
            sport,
            school
          )
        )
      `)
      .eq('id', groupPost.id)
      .single();

    return NextResponse.json({
      group_post: completeGroupPost || groupPost,
      message: 'Group post created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
