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
 * GET /api/group-posts/[id]
 * Fetch a specific group post with all details
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

    // Fetch group post with all related data - RLS handles access control
    const { data: groupPost, error: fetchError } = await supabase
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
          data_contributed,
          last_contribution,
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
        ),
        media:group_post_media (
          id,
          media_url,
          media_type,
          caption,
          position,
          uploaded_by,
          created_at
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Group post not found' }, { status: 404 });
      }
      console.error('Error fetching group post:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch group post' }, { status: 500 });
    }

    return NextResponse.json({ group_post: groupPost });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/group-posts/[id]
 * Update a group post (only creator can update)
 * Body: Partial group post fields (title, description, date, location, visibility, status)
 */
export async function PATCH(
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

    // Extract allowed fields
    const { title, description, date, location, visibility, status } = body;

    // Build update object
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (date !== undefined) updates.date = date;
    if (location !== undefined) updates.location = location;
    if (visibility !== undefined) updates.visibility = visibility;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Update group post - RLS will ensure only creator can update
    const { data: updatedGroupPost, error: updateError } = await supabase
      .from('group_posts')
      .update(updates)
      .eq('id', id)
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
          data_contributed,
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
      .single();

    if (updateError) {
      console.error('Error updating group post:', updateError);
      return NextResponse.json({ error: 'Failed to update group post' }, { status: 500 });
    }

    return NextResponse.json({
      group_post: updatedGroupPost,
      message: 'Group post updated successfully',
    });
  } catch (error) {
    console.error('Unexpected error in PATCH /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/group-posts/[id]
 * Delete a group post (only creator can delete)
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

    // Delete group post - RLS will ensure only creator can delete
    // CASCADE will handle deletion of participants, media, and sport-specific data
    const { error: deleteError } = await supabase
      .from('group_posts')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting group post:', deleteError);
      return NextResponse.json({ error: 'Failed to delete group post' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Group post deleted successfully',
    });
  } catch (error) {
    console.error('Unexpected error in DELETE /api/group-posts/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
