import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth, getServerClient } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

/**
 * POST /api/tags
 * Create new tags for a post
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseClient = getServerClient(request);
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
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

    // You can only tag people whose profile you can actually see (Round F).
    // Without this, anyone could tag a PRIVATE profile — including a
    // supervised minor — into their post, sight unseen. canViewProfile
    // already encodes owner/follower/guardian access, so tagging keeps
    // working inside real relationships (golf rounds tag participants via
    // their own server path, unaffected).
    const taggedIds = [...new Set(
      (tags as { taggedProfileId: string }[])
        .map(t => t.taggedProfileId)
        .filter(id => id && id !== user.id)
    )];
    const viewChecks = await Promise.all(
      taggedIds.map(id => canViewProfile(id, user.id))
    );
    if (viewChecks.some(check => !check.canView)) {
      return NextResponse.json(
        { error: 'You can only tag people whose profile you can view' },
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

    // Round H: tagging a SUPERVISED athlete bells their guardians (the
    // Round F gate means only someone who can view the child gets here, but
    // the family still wants to know). Actor excluded — a guardian tagging
    // their own child bells co-guardians only. Best-effort.
    if (taggedIds.length > 0) {
      const { data: taggedProfiles } = await supabase
        .from('profiles')
        .select('id, supervision_state, first_name')
        .in('id', taggedIds)
        .eq('supervision_state', 'supervised');
      if (taggedProfiles && taggedProfiles.length > 0) {
        const { notifyGuardians } = await import('@/lib/guardian-notify');
        for (const child of taggedProfiles) {
          await notifyGuardians(supabase, child.id, {
            type: 'tag_alert',
            title: `${child.first_name || 'Your athlete'} was tagged in a post`,
            actionUrl: `/feed?post=${postId}`,
            actorId: user.id,
            metadata: { post_id: postId },
          }, user.id);
        }
      }
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
    const supabase = getSupabaseAdmin();
    // Auth + privacy gates — this route runs on the admin client and used to
    // let anyone (logged out) enumerate all tags on any post or every post a
    // profile is tagged in, including private ones.
    const user = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    const profileId = searchParams.get('profileId'); // Get tagged posts for a profile

    if (!postId && !profileId) {
      return NextResponse.json(
        { error: 'Missing required parameter: postId or profileId' },
        { status: 400 }
      );
    }

    if (profileId && profileId !== user.id) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (!canView) {
        return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    if (postId) {
      // Same visibility rule as GET /api/posts?postId=
      const { data: post } = await supabase
        .from('posts')
        .select('id, profile_id, visibility, profiles:profile_id (visibility)')
        .eq('id', postId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      const owner = (Array.isArray(post.profiles) ? post.profiles[0] : post.profiles) as { visibility?: string } | null;
      const publiclyVisible = post.visibility === 'public' && owner?.visibility === 'public';
      if (post.profile_id !== user.id && !publiclyVisible) {
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', post.profile_id)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!follow) {
          return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }
      }
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

/** Strip one profile UUID from a post's tags array (the store the Tagged
 *  tab reads). Without this, tag removal was a no-op on the visible surface
 *  — post_tags rows changed while posts.tags kept serving the tab. */
async function stripFromPostTags(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  postId: string,
  profileId: string
): Promise<void> {
  const { data: post } = await supabase
    .from('posts')
    .select('tags')
    .eq('id', postId)
    .maybeSingle();
  if (!post?.tags || !post.tags.includes(profileId)) return;
  const { error } = await supabase
    .from('posts')
    .update({ tags: post.tags.filter((t: string) => t !== profileId) })
    .eq('id', postId);
  if (error) {
    console.error(`stripFromPostTags(${postId}, ${profileId}) failed:`, error.message);
  }
}

/**
 * DELETE /api/tags?tagId=xxx  — remove a tag row (creator or tagged person)
 * DELETE /api/tags?postId=xxx — untag YOURSELF from a post. Writes a
 *   status='removed' post_tags marker (notification-silent — the notify
 *   trigger only fires on status='active' inserts; the marker also stops
 *   group-round resync from re-adding you) and strips your UUID from
 *   posts.tags so the Tagged tab actually forgets the post.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabaseClient = getServerClient(request);
    const { data: { user } } = await supabaseClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get('tagId');
    const postId = searchParams.get('postId');

    if (postId) {
      // Self-untag by post. Verify the caller is actually tagged.
      const { data: post } = await supabase
        .from('posts')
        .select('id, profile_id, tags')
        .eq('id', postId)
        .maybeSingle();
      if (!post) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
      const { data: tagRow } = await supabase
        .from('post_tags')
        .select('id, status')
        .eq('post_id', postId)
        .eq('tagged_profile_id', user.id)
        .maybeSingle();
      const inPostTags = Array.isArray(post.tags) && post.tags.includes(user.id);
      if (!inPostTags && !tagRow) {
        return NextResponse.json({ error: 'You are not tagged in this post' }, { status: 404 });
      }

      // Marker row: upsert status='removed' (silent — trigger gates on
      // 'active'). Group-round resync reads these markers and won't re-add.
      const { error: markerError } = await supabase
        .from('post_tags')
        .upsert({
          post_id: postId,
          tagged_profile_id: user.id,
          created_by_profile_id: post.profile_id,
          status: 'removed',
        }, { onConflict: 'post_id,tagged_profile_id' });
      if (markerError) {
        console.error('untag marker upsert failed:', markerError.message);
      }

      await stripFromPostTags(supabase, postId, user.id);
      return NextResponse.json({ success: true });
    }

    if (!tagId) {
      return NextResponse.json(
        { error: 'Missing required parameter: tagId or postId' },
        { status: 400 }
      );
    }

    // Get the tag to verify permissions
    const { data: tag, error: fetchError } = await supabase
      .from('post_tags')
      .select('post_id, created_by_profile_id, tagged_profile_id')
      .eq('id', tagId)
      .single();

    if (fetchError || !tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // The creator, the tagged person — or the tagged person's GUARDIAN
    // (Round H, visibility + veto) — can remove the tag.
    let isGuardianOfTagged = false;
    if (tag.created_by_profile_id !== user.id && tag.tagged_profile_id !== user.id) {
      const { getProfileRole } = await import('@/lib/auth-server');
      const role = await getProfileRole(user.id, tag.tagged_profile_id);
      if (role !== 'guardian') {
        return NextResponse.json(
          { error: 'You can only remove tags you created or tags of yourself' },
          { status: 403 }
        );
      }
      isGuardianOfTagged = true;
    }

    // If the tagged person (or their guardian) is removing, update status
    // instead of deleting — the marker keeps resync from re-adding it.
    if (isGuardianOfTagged || (tag.tagged_profile_id === user.id && tag.created_by_profile_id !== user.id)) {
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

    // Either way, the Tagged tab reads posts.tags — strip it there too
    // (this branch used to be a no-op on the visible surface).
    await stripFromPostTags(supabase, tag.post_id, tag.tagged_profile_id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
