import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { FEATURE_FLAGS } from '@/lib/features';

// ── /api/guardian/pending-posts ──────────────────────────────────────────────
// The guardian approval queue: every pending_approval post across ALL of the
// caller's managed athletes, oldest first. Authorization is the profile_access
// guardian row — the same source of truth the posts PATCH approve/reject
// actions re-verify per call, so listing here never grants anything the
// decision endpoint wouldn't.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ posts: [] });
    }
    const admin = getSupabaseAdmin();

    const { data: accessRows, error: accessError } = await admin
      .from('profile_access')
      .select('profile_id')
      .eq('user_id', user.id)
      .eq('role', 'guardian');
    if (accessError) throw accessError;

    const managedIds = (accessRows ?? []).map(r => r.profile_id);
    if (managedIds.length === 0) {
      return NextResponse.json({ posts: [] });
    }

    const { data: posts, error: postsError } = await admin
      .from('posts')
      .select(`
        id,
        profile_id,
        caption,
        sport_key,
        created_at,
        post_media (
          id,
          media_url,
          media_type,
          thumbnail_url,
          display_order
        ),
        profiles:profile_id (
          id,
          first_name,
          last_name,
          full_name,
          handle,
          avatar_url
        )
      `)
      .in('profile_id', managedIds)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });
    if (postsError) throw postsError;

    // Proxy media of the minor's pending posts (guardian access is granted by
    // the post resolver's hasManagedAccess branch).
    const proxiedPosts = (posts ?? []).map((p) => {
      const post = p as { id: string; post_media?: Array<{ media_url: string; thumbnail_url: string | null }> };
      return {
        ...post,
        post_media: (post.post_media || []).map(m => ({
          ...m,
          media_url: toProxyUrl(m.media_url, { type: 'post', id: post.id }) ?? m.media_url,
          thumbnail_url: toProxyUrl(m.thumbnail_url, { type: 'post', id: post.id }),
        })),
      };
    });
    return NextResponse.json({ posts: proxiedPosts });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] pending-posts error:', error);
    return NextResponse.json({ error: 'Could not load pending posts' }, { status: 500 });
  }
}
