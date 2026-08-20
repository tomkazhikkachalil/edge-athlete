import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, getServerClient, getServerAuth } from '@/lib/auth-server';
import { extractHandles } from '@/lib/mentions';
import { notifyCommentMentions } from '@/lib/mentions/notify';
import { canViewProfile } from '@/lib/privacy';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';

// GET - Fetch comments for a post
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!postId || !UUID_RE.test(postId)) {
      return NextResponse.json(
        { error: 'Valid Post ID is required' },
        { status: 400 }
      );
    }

    // Bounded page (was unbounded — a viral post's thread would load every
    // comment in one response). Default generous enough that current clients
    // see no behavior change at MVP scale; hasMore lets a future UI paginate.
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const supabase = getServerClient(request);

    // Fetch comments with profile data and likes
    // Sort: pinned first, then by likes (most liked on top), then chronological
    const { data: comments, error } = await supabase
      .from('post_comments')
      .select(`
        *,
        profile:profile_id(
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          username,
          handle,
          avatar_url
        ),
        created_by:created_by_user_id(
          id,
          first_name,
          last_name,
          full_name
        ),
        comment_likes(profile_id)
      `)
      .eq('post_id', postId)
      .order('is_pinned', { ascending: false, nullsFirst: false })
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit); // limit+1 rows to compute hasMore

    if (error) {
      console.error('Error fetching comments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      );
    }

    const rows = comments || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Hydrate mentioned profiles: id + handle ONLY. The handle is already in
    // the comment text; this just confirms which tokens are real mentions —
    // no names/avatars of possibly-private users are exposed.
    const mentionIds = [
      ...new Set(pageRows.flatMap((c: { mentions?: string[] }) => c.mentions ?? [])),
    ];
    let mentionProfiles: { id: string; handle: string }[] = [];
    if (mentionIds.length > 0) {
      const { data: profs } = await getSupabaseAdmin()
        .from('profiles')
        .select('id, handle')
        .in('id', mentionIds)
        .not('handle', 'is', null);
      mentionProfiles = (profs ?? []) as { id: string; handle: string }[];
    }

    return NextResponse.json({
      comments: pageRows,
      hasMore,
      nextOffset: offset + Math.min(rows.length, limit),
      mentionProfiles
    });
  } catch (error) {
    console.error('Error in GET /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new comment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { postId, content, parentCommentId, gif_url } = body;

    if (!postId || (!content?.trim() && !gif_url)) {
      return NextResponse.json(
        { error: 'Post ID and content or GIF are required' },
        { status: 400 }
      );
    }

    const { supabase, user, error: userError } = await getServerAuth(request);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(request, 'comment-create', { userId: user.id });
    if (limited) return limited;

    // Get user's profile to get profile_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Comment author: the session user, or — guardian-profiles — a managed
    // athlete via targetProfileId (the posts route's pattern, verbatim
    // semantics: guardian row re-checked server-side, approved consent
    // required, attribution recorded in created_by_user_id).
    let authorId = profile.id;
    const targetProfileId =
      typeof body.targetProfileId === 'string' ? body.targetProfileId : null;
    if (targetProfileId && targetProfileId !== user.id) {
      if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
        return NextResponse.json({ error: 'Not available' }, { status: 404 });
      }
      const { getProfileRole } = await import('@/lib/auth-server');
      const role = await getProfileRole(user.id, targetProfileId);
      if (role !== 'guardian') {
        return NextResponse.json(
          { error: 'You do not have permission to comment as this profile' },
          { status: 403 }
        );
      }
      const { getConsentState } = await import('@/lib/consent');
      const consent = await getConsentState(getSupabaseAdmin(), targetProfileId);
      if (consent !== 'approved') {
        return NextResponse.json(
          { error: 'Parental consent must be approved before anything can be posted to this profile.' },
          { status: 403 }
        );
      }
      authorId = targetProfileId;
    }

    // A reply's parent must belong to the SAME post (a crafted request could
    // otherwise thread a reply under a comment on a different post)
    if (parentCommentId) {
      const { data: parentComment } = await supabase
        .from('post_comments')
        .select('id')
        .eq('id', parentCommentId)
        .eq('post_id', postId)
        .maybeSingle();
      if (!parentComment) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
      }
    }

    // Resolve @mentions SERVER-SIDE from the text (unforgeable — the client
    // sends nothing extra). Taggable by the author = public OR someone the
    // author follows (accepted, one-directional: canViewProfile semantics).
    // The admin client bypasses RLS, so this filter IS the privacy boundary.
    const trimmedContent: string | null = content?.trim() || null;
    const admin = getSupabaseAdmin();
    let mentionProfiles: { id: string; handle: string }[] = [];
    if (trimmedContent) {
      const handles = extractHandles(trimmedContent);
      if (handles.length > 0) {
        const { data: profs } = await admin
          .from('profiles')
          .select('id, handle, visibility')
          .in('handle', handles)
          // The AUTHOR is the mentioner — acting-as makes that the athlete,
          // so the taggable set is the athlete's follow graph (the comment
          // is theirs).
          .neq('id', authorId);
        if (profs && profs.length > 0) {
          const privateIds = profs.filter(p => p.visibility !== 'public').map(p => p.id);
          let followed = new Set<string>();
          if (privateIds.length > 0) {
            const { data: fRows } = await admin
              .from('follows')
              .select('following_id')
              .eq('follower_id', authorId)
              .eq('status', 'accepted')
              .in('following_id', privateIds);
            followed = new Set((fRows ?? []).map(r => r.following_id));
          }
          mentionProfiles = profs
            .filter(p => p.visibility === 'public' || followed.has(p.id))
            .map(p => ({ id: p.id, handle: p.handle as string }));
        }
      }
    }

    // Create comment. The acting-as branch writes via ADMIN: post_comments'
    // INSERT policy is auth.uid() = profile_id and the table isn't in 052's
    // guardian-write list — the branch is already fully authorized in app
    // code above (house rule). Normal comments keep the RLS client as
    // defense-in-depth.
    const insertData = {
      post_id: postId,
      profile_id: authorId,
      content: trimmedContent,
      gif_url: gif_url || null,
      parent_comment_id: parentCommentId || null,
      mentions: mentionProfiles.map(m => m.id),
      // Attribution (093): the human author when a guardian comments on
      // behalf. NULL for normal self-comments.
      ...(authorId !== user.id ? { created_by_user_id: user.id } : {}),
    };
    const COMMENT_RETURN = `
        *,
        profile:profile_id(
          id,
          first_name,
          middle_name,
          last_name,
          full_name,
          username,
          handle,
          avatar_url
        ),
        created_by:created_by_user_id(
          id,
          first_name,
          last_name,
          full_name
        )
      `;
    const writer = authorId !== user.id ? admin : supabase;
    let { data: comment, error: commentError } = await writer
      .from('post_comments')
      .insert(insertData)
      .select(COMMENT_RETURN)
      .single();

    // Migration-lag guard (093 pattern from posts/090): retry without the
    // attribution column if it hasn't been applied yet.
    if (
      commentError &&
      insertData.created_by_user_id !== undefined &&
      (commentError.code === '42703' || commentError.code === 'PGRST204') &&
      (commentError.message || '').includes('created_by_user_id')
    ) {
      console.warn('[COMMENTS] created_by_user_id missing (migration 093 not applied) — retrying without it');
      delete (insertData as Record<string, unknown>).created_by_user_id;
      ({ data: comment, error: commentError } = await writer
        .from('post_comments')
        .insert(insertData)
        .select(COMMENT_RETURN)
        .single());
    }

    if (commentError) {
      console.error('Error creating comment:', commentError);
      return NextResponse.json(
        { error: 'Failed to create comment' },
        { status: 500 }
      );
    }

    // Count actual rows and sync cached column
    const { count } = await admin
      .from('post_comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId);

    const trueCount = count ?? 0;
    await admin.from('posts').update({ comments_count: trueCount }).eq('id', postId);

    // Mention notifications — best-effort, and only to people who can see
    // the post's owner (never mint a dead-link notification for someone the
    // post is invisible to).
    if (mentionProfiles.length > 0) {
      const { data: post } = await admin
        .from('posts')
        .select('profile_id')
        .eq('id', postId)
        .maybeSingle();
      if (post) {
        const visible: string[] = [];
        for (const m of mentionProfiles) {
          const { canView } = await canViewProfile(post.profile_id, m.id);
          if (canView) visible.push(m.id);
        }
        await notifyCommentMentions(admin, {
          postId,
          commentId: comment.id,
          // The AUTHOR (the athlete on the acting-as branch) — attribution
          // lives in created_by_user_id + the byline, not notification
          // actors (Round-2 scope decision, same as posts).
          authorId,
          mentionedIds: visible,
          content: trimmedContent,
        });
      }
    }

    return NextResponse.json(
      { comment, commentsCount: trueCount, mentionProfiles },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a comment
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');

    if (!commentId) {
      return NextResponse.json(
        { error: 'Comment ID is required' },
        { status: 400 }
      );
    }

    const { supabase, user, error: userError } = await getServerAuth(request);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get the post_id + author before deleting so we can update the cached
    // count and decide the guardian path. Admin lookup on purpose: the RLS
    // client may not be able to SELECT a private post's comments, which
    // would silently skip the guardian branch. Nothing here is returned to
    // the caller — authorization is the role check + the RLS delete below.
    const { data: commentData } = await getSupabaseAdmin()
      .from('post_comments')
      .select('post_id, profile_id')
      .eq('id', commentId)
      .single();

    const postId = commentData?.post_id;

    // Guardian-profiles: a guardian may delete their managed athlete's
    // comments (write_content/approve_content in the matrix — including
    // ones they just wrote acting-as). RLS is auth.uid() = profile_id, so
    // this path goes through the admin client AFTER the role check.
    let deleter = supabase;
    if (
      FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
      commentData &&
      commentData.profile_id !== user.id
    ) {
      const { getProfileRole } = await import('@/lib/auth-server');
      const role = await getProfileRole(user.id, commentData.profile_id);
      if (role === 'guardian') deleter = getSupabaseAdmin();
      // Non-guardians fall through to the RLS delete, which no-ops → 404.
    }

    // Delete comment (RLS will ensure user can only delete their own).
    // count:'exact' so a no-op (not yours / already gone) returns 404
    // instead of a false success.
    const { error: deleteError, count: deletedCount } = await deleter
      .from('post_comments')
      .delete({ count: 'exact' })
      .eq('id', commentId);

    if (!deleteError && !deletedCount) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (deleteError) {
      console.error('Error deleting comment:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete comment' },
        { status: 500 }
      );
    }

    // Count actual rows and sync cached column
    let commentsCount = 0;
    if (postId) {
      const admin = getSupabaseAdmin();
      const { count } = await admin
        .from('post_comments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postId);

      commentsCount = count ?? 0;
      await admin.from('posts').update({ comments_count: commentsCount }).eq('id', postId);
    }

    return NextResponse.json({ success: true, commentsCount });
  } catch (error) {
    console.error('Error in DELETE /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH - Pin or unpin a comment (post owner only)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { commentId, postId, action } = body;

    if (!commentId || !postId || !['pin', 'unpin'].includes(action)) {
      return NextResponse.json(
        { error: 'commentId, postId, and action (pin/unpin) are required' },
        { status: 400 }
      );
    }

    const { user, error: userError } = await getServerAuth(request);
    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Verify caller is the post owner
    const admin = getSupabaseAdmin();
    const { data: post } = await admin
      .from('posts')
      .select('profile_id')
      .eq('id', postId)
      .single();

    if (!post || post.profile_id !== user.id) {
      return NextResponse.json({ error: 'Only the post owner can pin comments' }, { status: 403 });
    }

    if (action === 'pin') {
      // Unpin any existing pinned comment for this post first
      await admin
        .from('post_comments')
        .update({ is_pinned: false })
        .eq('post_id', postId)
        .eq('is_pinned', true);

      // Pin the target comment
      const { error: pinError } = await admin
        .from('post_comments')
        .update({ is_pinned: true })
        .eq('id', commentId)
        .eq('post_id', postId);

      if (pinError) {
        console.error('Error pinning comment:', pinError);
        return NextResponse.json({ error: 'Failed to pin comment' }, { status: 500 });
      }
    } else {
      // Unpin the comment — scoped to the ownership-verified post, exactly
      // like the pin path (without .eq('post_id') any post owner could unpin
      // comments on other people's posts via a foreign commentId).
      const { error: unpinError } = await admin
        .from('post_comments')
        .update({ is_pinned: false })
        .eq('id', commentId)
        .eq('post_id', postId);

      if (unpinError) {
        console.error('Error unpinning comment:', unpinError);
        return NextResponse.json({ error: 'Failed to unpin comment' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, action });
  } catch (error) {
    console.error('Error in PATCH /api/comments:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
