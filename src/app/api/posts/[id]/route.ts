import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseAdmin();
    const { id: postId } = await params;

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
          school
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

    // Private-post gate: a private post is visible only to its owner and to
    // viewers permitted to see the author's profile. Return 404 (not 403) so
    // the endpoint doesn't confirm a hidden post's existence.
    if (post.visibility === 'private') {
      const ownerId = post.profile_id as string;
      const isOwner = viewerId === ownerId;
      let allowed = isOwner;
      if (!allowed && viewerId) {
        const { canView } = await canViewProfile(ownerId, viewerId);
        allowed = canView;
      }
      if (!allowed) {
        return NextResponse.json({ error: 'Post not found' }, { status: 404 });
      }
    }

    return NextResponse.json({ post });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Error fetching post:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
