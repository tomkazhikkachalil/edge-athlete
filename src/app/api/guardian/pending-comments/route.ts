import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';

// ── /api/guardian/pending-comments ───────────────────────────────────────────
// The comment half of the approval queue (095): every pending_approval
// comment across ALL of the caller's managed athletes, oldest first, with
// the parent post's caption/owner for review context. Authorization is the
// profile_access guardian row — the same source of truth PATCH
// /api/comments approve/reject re-verifies per call.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ comments: [] });
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
      return NextResponse.json({ comments: [] });
    }

    const { data: comments, error: commentsError } = await admin
      .from('post_comments')
      .select(`
        id,
        post_id,
        profile_id,
        content,
        gif_url,
        created_at,
        profile:profile_id (
          id,
          first_name,
          last_name,
          full_name,
          handle,
          avatar_url
        ),
        post:post_id (
          id,
          caption,
          profile_id
        )
      `)
      .in('profile_id', managedIds)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });
    if (commentsError) throw commentsError;

    return NextResponse.json({ comments: comments ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] pending-comments error:', error);
    return NextResponse.json({ error: 'Could not load pending comments' }, { status: 500 });
  }
}
