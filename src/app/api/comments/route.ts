import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';
import { extractHandles } from '@/lib/mentions';
import { notifyCommentMentions } from '@/lib/mentions/notify';
import { canViewProfile } from '@/lib/privacy';
import { enforceRateLimit } from '@/lib/rate-limit';

// Resolve @mentions SERVER-SIDE from the text (unforgeable — the client sends
// nothing extra). Taggable by the author = public OR someone the author
// follows (accepted, one-directional: canViewProfile semantics). The admin
// client bypasses RLS, so this filter IS the privacy boundary. Shared by the
// POST create path and the scoped send-back 'edit' action, which must
// RE-resolve — the approve-time deferred fan-out reads the stored mentions,
// and stale ones would notify people the edited text no longer names.
async function resolveMentions(
  admin: ReturnType<typeof getSupabaseAdmin>,
  authorId: string,
  content: string | null
): Promise<{ id: string; handle: string }[]> {
  if (!content) return [];
  const handles = extractHandles(content);
  if (handles.length === 0) return [];
  const { data: profs } = await admin
    .from('profiles')
    .select('id, handle, visibility')
    .in('handle', handles)
    // The AUTHOR is the mentioner — acting-as makes that the athlete, so the
    // taggable set is the athlete's follow graph (the comment is theirs).
    .neq('id', authorId);
  if (!profs || profs.length === 0) return [];
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
  return profs
    .filter(p => p.visibility === 'public' || followed.has(p.id))
    .map(p => ({ id: p.id, handle: p.handle as string }));
}

// GET - Fetch comments for a post
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');

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

    // Viewer-aware (095): everyone sees published; an authenticated viewer
    // ALSO sees their own pending/rejected comments (a supervised child must
    // see where their held comment went). Guardians review in the approvals
    // queue, not inline.
    const { supabase, user: viewer } = await getServerAuth(request);

    // Fetch comments with profile data and likes
    // Sort: pinned first, then by likes (most liked on top), then chronological
    let commentsQuery = supabase
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
      .eq('post_id', postId);
    commentsQuery = viewer
      ? commentsQuery.or(`status.eq.published,profile_id.eq.${viewer.id}`)
      : commentsQuery.eq('status', 'published');
    const { data: comments, error } = await commentsQuery
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

    if (postId && !UUID_RE.test(postId)) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }
    if (parentCommentId && !UUID_RE.test(parentCommentId)) {
      return NextResponse.json({ error: 'Invalid comment ID' }, { status: 400 });
    }
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
    // Shared acting-as gate (guardian-gate.ts) — flag 404 → guardian 403 →
    // approved-consent 403, identical semantics to posts and group-posts.
    const targetProfileId =
      typeof body.targetProfileId === 'string' ? body.targetProfileId : null;
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(
      user.id, targetProfileId, 'You do not have permission to comment as this profile'
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const authorId = gate.actingAs ? gate.actorId : profile.id;

    // Supervised minors commenting as THEMSELVES: the guardian's per-athlete
    // comment_moderation toggle decides instant vs held-for-review (095).
    // Mirrors the posts pending pipeline; guardian acting-as comments are
    // the guardian's own words and are never held.
    // Keyed on the GATE result, not on raw targetProfileId (Round E): the old
    // `!targetProfileId` check let a child send targetProfileId = their own
    // id and skip moderation entirely.
    // Unconditional (Wave 1 inversion): the held pipeline is a safety
    // behavior, not a feature surface — no flag can disable it.
    let commentStatus: 'published' | 'pending_approval' = 'published';
    if (!gate.actingAs) {
      const { getProfileRole } = await import('@/lib/auth-server');
      const selfRole = await getProfileRole(user.id, user.id);
      if (selfRole === 'supervised') {
        const { data: modRow } = await getSupabaseAdmin()
          .from('profiles')
          .select('comment_moderation')
          .eq('id', user.id)
          .maybeSingle();
        const { resolveCommentStatus } = await import('@/lib/supervised-gates');
        commentStatus = resolveCommentStatus(selfRole, modRow?.comment_moderation);
      }
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

    // @mentions — shared resolver (see resolveMentions above).
    const trimmedContent: string | null = content?.trim() || null;
    const admin = getSupabaseAdmin();
    const mentionProfiles = await resolveMentions(admin, authorId, trimmedContent);

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
      // Moderation (095): held comments are invisible until a guardian
      // approves. Omit when published — the DB default covers it.
      ...(commentStatus === 'pending_approval' ? { status: 'pending_approval' } : {}),
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

    // Count actual rows and sync cached column — published only (095): a
    // held comment must not bump the public count.
    const { count } = await admin
      .from('post_comments')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('status', 'published');

    const trueCount = count ?? 0;
    await admin.from('posts').update({ comments_count: trueCount }).eq('id', postId);

    // Held comment: no fan-out of any kind until approval (the DB post-owner
    // trigger is also status-guarded). Tell the guardians instead.
    if (commentStatus === 'pending_approval') {
      const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
      const childName = await profileFirstName(admin, authorId);
      await notifyGuardians(admin, authorId, {
        type: 'comment_pending_approval',
        title: `${childName} wrote a comment that needs your review`,
        actionUrl: '/app/guardian/approvals',
        actorId: authorId,
        metadata: { comment_id: comment.id, post_id: postId },
      });
      return NextResponse.json(
        { comment, commentsCount: trueCount, mentionProfiles: [], held: true },
        { status: 201 }
      );
    }

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

    // Count actual rows and sync cached column — published only (095)
    let commentsCount = 0;
    if (postId) {
      const admin = getSupabaseAdmin();
      const { count } = await admin
        .from('post_comments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', postId)
        .eq('status', 'published');

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

// PATCH - Pin/unpin a comment (post owner), approve/reject/request_changes on
// a held comment (guardian of the comment's author — 095 moderation queue),
// or the scoped 'edit' resubmit (the comment's author, only from
// changes_requested — published comments stay immutable).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { commentId, postId, action } = body;

    if (!commentId || !postId || !['pin', 'unpin', 'approve', 'reject', 'request_changes', 'edit'].includes(action)) {
      return NextResponse.json(
        { error: "commentId, postId, and action (pin/unpin/approve/reject/request_changes/edit) are required" },
        { status: 400 }
      );
    }

    const { user, error: userError } = await getServerAuth(request);
    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // ── Moderation-queue actions (guardian-profiles, 095) ────────────────────
    // Not flag-gated: the held pipeline runs unconditionally (Wave 1
    // inversion), so its release valve must too — role checks are the gate.
    if (action === 'approve' || action === 'reject' || action === 'request_changes' || action === 'edit') {
      const { data: heldComment } = await admin
        .from('post_comments')
        .select('id, post_id, profile_id, status, content, gif_url, mentions')
        .eq('id', commentId)
        .eq('post_id', postId)
        .maybeSingle();
      if (!heldComment) {
        return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
      }

      // Scoped edit = the send-back resubmit (Wave 2, mig 129). Author-only
      // and ONLY from changes_requested: this is the child's "fix and resend"
      // path, not a general comment editor — published words stay immutable.
      if (action === 'edit') {
        if (heldComment.profile_id !== user.id) {
          return NextResponse.json({ error: 'Only the comment author can edit it' }, { status: 403 });
        }
        if (heldComment.status !== 'changes_requested') {
          return NextResponse.json({ error: 'Only sent-back comments can be edited' }, { status: 400 });
        }
        const newContent = typeof body.content === 'string' ? body.content.trim() : '';
        if (!newContent && !heldComment.gif_url) {
          return NextResponse.json({ error: 'Write something before resending.' }, { status: 400 });
        }
        // Re-resolve mentions from the NEW text — the approve-time deferred
        // fan-out reads the stored list, and stale entries would notify
        // people the edit no longer names.
        const mentionProfiles = await resolveMentions(admin, heldComment.profile_id, newContent || null);
        const { error: editError } = await admin
          .from('post_comments')
          .update({
            content: newContent || null,
            mentions: mentionProfiles.map(m => m.id),
            status: 'pending_approval',
            review_note: null,
          })
          .eq('id', commentId);
        if (editError) {
          return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
        }
        {
          const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
          const childName = await profileFirstName(admin, heldComment.profile_id);
          await notifyGuardians(admin, heldComment.profile_id, {
            type: 'comment_pending_approval',
            title: `${childName} edited a comment for your review`,
            actionUrl: '/app/guardian/approvals',
            actorId: user.id,
            metadata: { comment_id: commentId, post_id: heldComment.post_id, resubmitted: true },
          }, user.id);
        }
        return NextResponse.json({ ok: true, status: 'pending_approval' });
      }

      const { getProfileRole } = await import('@/lib/auth-server');
      const { resolveProfileAction } = await import('@/lib/profile-roles');
      const role = await getProfileRole(user.id, heldComment.profile_id);
      if (!resolveProfileAction(role, 'approve_content')) {
        return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
      }
      if (heldComment.status !== 'pending_approval') {
        return NextResponse.json({ error: 'This comment is not awaiting approval' }, { status: 400 });
      }

      // Send back with a note — ungated like reject (nothing publishes); the
      // child edits and resubmits via the scoped 'edit' action above.
      if (action === 'request_changes') {
        const note = typeof body.note === 'string' ? body.note.trim() : '';
        if (note.length > 500) {
          return NextResponse.json({ error: 'Keep the note under 500 characters.' }, { status: 400 });
        }
        const { error: sendBackError } = await admin
          .from('post_comments')
          .update({ status: 'changes_requested', review_note: note || null })
          .eq('id', commentId);
        if (sendBackError) {
          return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
        }
        {
          const { notifyUser } = await import('@/lib/guardian-notify');
          await notifyUser(admin, heldComment.profile_id, {
            type: 'comment_approval_result',
            title: 'Your guardian asked for changes to your comment',
            message: note || null,
            actionUrl: `/feed?post=${heldComment.post_id}`,
            actorId: user.id,
            metadata: { comment_id: commentId, post_id: heldComment.post_id, result: 'changes_requested' },
          });
        }
        return NextResponse.json({ ok: true, status: 'changes_requested' });
      }
      // Publishing a child's words requires approved consent — same gate as
      // post approval (A4). Rejection is data minimization and stays open.
      if (action === 'approve') {
        const { getConsentState } = await import('@/lib/consent');
        const consent = await getConsentState(admin, heldComment.profile_id);
        if (consent !== 'approved') {
          return NextResponse.json(
            { error: 'Complete the consent review before approving.', code: 'consent_required' },
            { status: 403 }
          );
        }
      }

      const { error: statusError } = await admin
        .from('post_comments')
        .update({ status: action === 'approve' ? 'published' : 'rejected' })
        .eq('id', commentId);
      if (statusError) {
        return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
      }
      // The count trigger re-syncs on UPDATE OF status (095).

      if (action === 'approve') {
        // The fan-out the held path skipped, now that the words are public.
        // 1. Post owner (the DB trigger only fires on INSERT) — best-effort.
        const { data: parentPost } = await admin
          .from('posts')
          .select('profile_id')
          .eq('id', heldComment.post_id)
          .maybeSingle();
        if (parentPost && parentPost.profile_id !== heldComment.profile_id) {
          const { profileFirstName } = await import('@/lib/guardian-notify');
          const actorName = await profileFirstName(admin, heldComment.profile_id);
          await admin.rpc('create_notification', {
            p_user_id: parentPost.profile_id,
            p_type: 'comment',
            p_actor_id: heldComment.profile_id,
            p_title: `${actorName} commented on your post`,
            p_action_url: '/feed',
            p_post_id: heldComment.post_id,
            p_comment_id: heldComment.id,
            p_metadata: { post_id: heldComment.post_id, comment_id: heldComment.id },
          });
        }
        // 2. Deferred @mention notifications (visibility re-checked).
        const mentionIds: string[] = Array.isArray(heldComment.mentions) ? heldComment.mentions : [];
        if (mentionIds.length > 0 && parentPost) {
          const visible: string[] = [];
          for (const m of mentionIds) {
            const { canView } = await canViewProfile(parentPost.profile_id, m);
            if (canView) visible.push(m);
          }
          await notifyCommentMentions(admin, {
            postId: heldComment.post_id,
            commentId: heldComment.id,
            authorId: heldComment.profile_id,
            mentionedIds: visible,
            content: heldComment.content,
          });
        }
      }

      // Tell the child what happened (their bell, next PIN login).
      {
        const { notifyUser } = await import('@/lib/guardian-notify');
        await notifyUser(admin, heldComment.profile_id, {
          type: 'comment_approval_result',
          title: action === 'approve'
            ? 'Your comment was approved and is now visible'
            : "Your comment wasn't approved",
          actionUrl: action === 'approve' ? `/feed?post=${heldComment.post_id}` : null,
          actorId: user.id,
          metadata: { comment_id: commentId, post_id: heldComment.post_id, result: action },
        });
      }
      return NextResponse.json({ ok: true, status: action === 'approve' ? 'published' : 'rejected' });
    }

    // ── Pin/unpin (post owner only) ──────────────────────────────────────────
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
