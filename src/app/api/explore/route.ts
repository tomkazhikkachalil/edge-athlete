import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getSportDefinition, SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { FEATURE_FLAGS } from '@/lib/features';

/**
 * GET /api/explore?sport=<sport_key>&limit=24
 *
 * Browse surface for the Explore page — no search query required
 * (the sibling of /api/search, which needs `q`).
 *
 * Returns public athletes (optionally filtered by sport) and recent public
 * posts. Only public profiles/posts are ever returned, so no viewer auth is
 * required — private content stays behind the follow system.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sportKey = searchParams.get('sport')?.trim() || null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10) || 24, 48);

    if (sportKey && !(sportKey in SPORT_REGISTRY)) {
      return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // ── Athletes (public only) ────────────────────────────────────────────
    let athleteQuery = supabase
      .from('profiles')
      .select('id, full_name, first_name, middle_name, last_name, avatar_url, handle, sport, school, location, created_at')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sportKey) {
      // profiles.sport stores a display label (e.g. "Golf"); match on the
      // registry display name, case-insensitively.
      const displayName = getSportDefinition(sportKey as SportKey).display_name;
      athleteQuery = athleteQuery.ilike('sport', displayName);
    }

    // ── Recent posts (public only) ────────────────────────────────────────
    let postQuery = supabase
      .from('posts')
      .select(`
        id, caption, sport_key, created_at, likes_count, comments_count,
        profile:profiles!posts_profile_id_fkey (
          id, full_name, first_name, last_name, avatar_url, handle, sport, school, visibility
        ),
        media:post_media ( id )
      `)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sportKey) {
      postQuery = postQuery.eq('sport_key', sportKey);
    }

    // Flag-gated: posts.status doesn't exist until migration 051 runs.
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      postQuery = postQuery.eq('status', 'published');
    }

    const [athletesResult, postsResult] = await Promise.all([athleteQuery, postQuery]);

    if (athletesResult.error) {
      console.error('[explore] athletes query error:', athletesResult.error);
    }
    if (postsResult.error) {
      console.error('[explore] posts query error:', postsResult.error);
    }

    // Exclude posts whose author profile is private (post visibility is
    // per-post, but a private author's content shouldn't surface in browse).
    const posts = (postsResult.data || []).filter(p => {
      const prof = Array.isArray(p.profile) ? p.profile[0] : p.profile;
      return prof && (prof as { visibility?: string }).visibility === 'public';
    });

    return NextResponse.json({
      athletes: athletesResult.data || [],
      posts,
    });
  } catch (e) {
    console.error('[explore] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
