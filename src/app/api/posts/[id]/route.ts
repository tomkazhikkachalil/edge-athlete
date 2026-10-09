import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { canReadPost } from '@/lib/posts/read-gate';
import { FEATURE_FLAGS } from '@/lib/features';
import { reportRouteError } from '@/lib/observability/report';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id: postId } = await params;
    if (!isUuid(postId)) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }

    // Optional auth — public posts are viewable by anyone; private posts are
    // gated below. (Admin client bypasses RLS, so we gate here.)
    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

    const { data: post, error } = await supabase
      .from('posts')
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
          school,
          visibility
        ),
        media:post_media (
          id,
          media_url,
          media_type,
          thumbnail_url,
          display_order
        ),
        likes:post_likes (
          profile_id
        ),
        saved_posts (
          profile_id
        ),
        golf_round:round_id (
          id,
          date,
          course,
          course_location,
          tee,
          holes,
          par,
          gross_score,
          total_putts,
          fir_percentage,
          gir_percentage,
          weather,
          temperature,
          wind,
          course_rating,
          slope_rating,
          golf_holes (
            hole_number,
            par,
            strokes,
            putts,
            distance_yards,
            fairway_hit,
            green_in_regulation
          )
        )
      `)
      .eq('id', postId)
      .single();

    if (error || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // The read gate (`canReadPost` — the feed's rule): the owner and their
    // guardian always; anyone else a PUBLISHED post, public on a public
    // account for all, otherwise approved fans only. 404, never 403, so the
    // endpoint doesn't confirm a hidden post exists.
    const ownerId = post.profile_id as string;
    const isOwner = viewerId === ownerId;
    const author = (Array.isArray(post.profile) ? post.profile[0] : post.profile) as { visibility?: string | null } | null;
    let hasAccess = false;
    let isFan = false;
    if (viewerId && !isOwner) {
      const [access, follow] = await Promise.all([
        FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES
          ? supabase.from('profile_access').select('role').eq('user_id', viewerId).eq('profile_id', ownerId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('follows').select('status').eq('follower_id', viewerId).eq('following_id', ownerId).maybeSingle(),
      ]);
      hasAccess = !!access.data;
      isFan = follow.data?.status === 'accepted';
    }
    const allowed = canReadPost({
      isOwner,
      hasAccess,
      isFan,
      postVisibility: post.visibility ?? null,
      profileVisibility: author?.visibility ?? null,
      status: (post as { status?: string | null }).status ?? null,
    });
    if (!allowed) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    // Proxy this post's media bytes (governed by the post rule; id = post.id).
    const pm = post as { id: string; media?: Array<{ media_url: string; thumbnail_url: string | null }> };
    if (Array.isArray(pm.media)) {
      // A private post's URLs expire (speed round 2); this read has no owner
      // visibility in its select, so a public post keeps the stable form.
      const life = post.visibility === 'private' ? { visibility: 'private' as const } : {};
      pm.media = pm.media.map(m => ({
        ...m,
        media_url: toProxyUrl(m.media_url, { type: 'post', id: pm.id }, life) ?? m.media_url,
        thumbnail_url: toProxyUrl(m.thumbnail_url, { type: 'post', id: pm.id }, life),
      }));
    }
    return NextResponse.json({ post });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Error fetching post:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
