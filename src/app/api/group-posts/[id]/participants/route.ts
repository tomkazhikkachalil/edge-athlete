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
 * GET /api/group-posts/[id]/participants
 * Fetch all participants for a group post
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Fetch participants - RLS handles access control
    const { data: participants, error: fetchError } = await supabase
      .from('group_post_participants')
      .select(`
        *,
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
      `)
      .eq('group_post_id', id)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching participants:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 });
    }

    return NextResponse.json({ participants: participants || [] });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/group-posts/[id]/participants
 * Add participants to a group post
 * Body:
 *   - participant_ids: Array of profile IDs to add (required)
 *   - role: Role for participants (default: 'participant')
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { participant_ids, role } = body;

    // Validate input
    if (!participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
      return NextResponse.json(
        { error: 'participant_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    // Verify user is creator or organizer - check group post
    const { data: groupPost, error: groupPostError } = await supabase
      .from('group_posts')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (groupPostError || !groupPost) {
      return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
    }

    // Check if user is creator or organizer
    const isCreator = groupPost.creator_id === user.id;
    let isOrganizer = false;

    if (!isCreator) {
      const { data: participant } = await supabase
        .from('group_post_participants')
        .select('role')
        .eq('group_post_id', id)
        .eq('profile_id', user.id)
        .single();

      isOrganizer = participant?.role === 'organizer';
    }

    if (!isCreator && !isOrganizer) {
      return NextResponse.json(
        { error: 'Only creator or organizers can add participants' },
        { status: 403 }
      );
    }

    // Add participants
    const participantInserts = participant_ids.map((profile_id: string) => ({
      group_post_id: id,
      profile_id,
      role: role || 'participant',
      status: 'pending',
    }));

    const { data: newParticipants, error: insertError } = await supabase
      .from('group_post_participants')
      .insert(participantInserts)
      .select(`
        *,
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
      `);

    if (insertError) {
      // Check if it's a duplicate error
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'One or more participants are already in this group post' },
          { status: 409 }
        );
      }
      console.error('Error adding participants:', insertError);
      return NextResponse.json({ error: 'Failed to add participants' }, { status: 500 });
    }

    return NextResponse.json({
      participants: newParticipants,
      message: 'Participants added successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/group-posts/[id]/participants
 * Remove a participant from a group post
 * Body:
 *   - participant_id: Profile ID to remove (required)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { participant_id } = body;

    if (!participant_id) {
      return NextResponse.json(
        { error: 'participant_id is required' },
        { status: 400 }
      );
    }

    // Verify user is creator, organizer, or removing themselves
    const { data: groupPost } = await supabase
      .from('group_posts')
      .select('creator_id')
      .eq('id', id)
      .single();

    if (!groupPost) {
      return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
    }

    const isCreator = groupPost.creator_id === user.id;
    const isRemovingSelf = participant_id === user.id;

    let isOrganizer = false;
    if (!isCreator && !isRemovingSelf) {
      const { data: participant } = await supabase
        .from('group_post_participants')
        .select('role')
        .eq('group_post_id', id)
        .eq('profile_id', user.id)
        .single();

      isOrganizer = participant?.role === 'organizer';
    }

    if (!isCreator && !isOrganizer && !isRemovingSelf) {
      return NextResponse.json(
        { error: 'Only creator, organizers, or the participant themselves can remove participants' },
        { status: 403 }
      );
    }

    // Prevent removing the creator
    if (participant_id === groupPost.creator_id) {
      return NextResponse.json(
        { error: 'Cannot remove the creator from the group post' },
        { status: 400 }
      );
    }

    // Remove participant - CASCADE will handle related data
    const { error: deleteError } = await supabase
      .from('group_post_participants')
      .delete()
      .eq('group_post_id', id)
      .eq('profile_id', participant_id);

    if (deleteError) {
      console.error('Error removing participant:', deleteError);
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Participant removed successfully',
    });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/group-posts/[id]/participants:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
