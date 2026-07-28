import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
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

    return NextResponse.json({ posts: posts ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] pending-posts error:', error);
    return NextResponse.json({ error: 'Could not load pending posts' }, { status: 500 });
  }
}
