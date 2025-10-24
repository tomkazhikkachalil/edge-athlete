import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Helper to get authenticated user from cookie
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
 * POST /api/tags
 * Create new tags for a post
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseClient = createSupabaseClient(request);
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { postId, tags } = body;

    if (!postId || !tags || !Array.isArray(tags)) {
      return NextResponse.json(
        { error: 'Missing required fields: postId and tags array' },
        { status: 400 }
      );
    }

    // Verify user owns the post
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('profile_id')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    if (post.profile_id !== user.id) {
      return NextResponse.json(
        { error: 'You can only tag people in your own posts' },
        { status: 403 }
      );
    }

    // Prepare tag records
    const tagRecords = tags.map((tag: {
      taggedProfileId: string;
      mediaId?: string;
      positionX?: number;
      positionY?: number;
    }) => ({
      post_id: postId,
      tagged_profile_id: tag.taggedProfileId,
      created_by_profile_id: user.id,
      media_id: tag.mediaId || null,
      position_x: tag.positionX || null,
      position_y: tag.positionY || null,
      status: 'active'
    }));

    // Insert tags (upsert to handle duplicates)
    const { data: createdTags, error: tagError } = await supabase
      .from('post_tags')
      .upsert(tagRecords, {
        onConflict: 'post_id,tagged_profile_id',
        ignoreDuplicates: false
      })
      .select();

    if (tagError) {
      console.error('Tag creation error:', tagError);
      return NextResponse.json(
        { error: 'Failed to create tags', details: tagError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tags: createdTags
    });
  } catch (error) {
    console.error('Error creating tags:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/tags?postId=xxx
 * Get tags for a specific post
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    const profileId = searchParams.get('profileId'); // Get tagged posts for a profile

    if (!postId && !profileId) {
      return NextResponse.json(
        { error: 'Missing required parameter: postId or profileId' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('post_tags')
      .select(`
        id,
        post_id,
        media_id,
        position_x,
        position_y,
        status,
        created_at,
        tagged_profile:tagged_profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        ),
        created_by:created_by_profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name
        )
      `)
      .eq('status', 'active');

    if (postId) {
      query = query.eq('post_id', postId);
    } else if (profileId) {
      query = query.eq('tagged_profile_id', profileId);
    }

    const { data: tags, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tags:', error);
      return NextResponse.json(
        { error: 'Failed to fetch tags' },
        { status: 500 }
      );
    }

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tags?tagId=xxx
 * Remove a tag (by creator or tagged person)
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabaseClient = createSupabaseClient(request);
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get('tagId');

    if (!tagId) {
      return NextResponse.json(
        { error: 'Missing required parameter: tagId' },
        { status: 400 }
      );
    }

    // Get the tag to verify permissions
    const { data: tag, error: fetchError } = await supabase
      .from('post_tags')
      .select('created_by_profile_id, tagged_profile_id')
      .eq('id', tagId)
      .single();

    if (fetchError || !tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Only the creator or the tagged person can remove the tag
    if (tag.created_by_profile_id !== user.id && tag.tagged_profile_id !== user.id) {
      return NextResponse.json(
        { error: 'You can only remove tags you created or tags of yourself' },
        { status: 403 }
      );
    }

    // If tagged person is removing, update status instead of deleting
    if (tag.tagged_profile_id === user.id && tag.created_by_profile_id !== user.id) {
      const { error: updateError } = await supabase
        .from('post_tags')
        .update({ status: 'removed' })
        .eq('id', tagId);

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to remove tag' },
          { status: 500 }
        );
      }
    } else {
      // Creator can delete completely
      const { error: deleteError } = await supabase
        .from('post_tags')
        .delete()
        .eq('id', tagId);

      if (deleteError) {
        return NextResponse.json(
          { error: 'Failed to delete tag' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
