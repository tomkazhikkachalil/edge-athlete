import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getSportDefinition, SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { FEATURE_FLAGS } from '@/lib/features';
import { searchPeople } from '@/lib/search/people-server';
import { hasLocationFilter, readLocationParams } from '@/lib/geo/params';
import { enforceRateLimit } from '@/lib/rate-limit';

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
    const limited = await enforceRateLimit(request, 'search');
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const sportKey = searchParams.get('sport')?.trim() || null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '24', 10) || 24, 48);

    if (sportKey && !(sportKey in SPORT_REGISTRY)) {
      return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Athlete search (108): text and/or a location constraint route through
    // search_people (public audience only — Explore is a guest surface);
    // otherwise the newest public athletes, as before.
    const q = searchParams.get('q')?.trim() ?? '';
    const location = readLocationParams(searchParams);
    const searching = Boolean(q) || hasLocationFilter(location);

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

    const athletesPromise = searching
      ? searchPeople({ query: q, visibleIds: [], includePublic: true, limit, location }).then(people => {
          // The sport chip stays a post-filter here, as in /api/search
          // (profiles.sport is a display label).
          const label = sportKey ? getSportDefinition(sportKey as SportKey).display_name.toLowerCase() : null;
          return {
            data: people
              .filter(p => !label || (p.sport ?? '').toLowerCase() === label)
              .map(p => ({
                id: p.id, full_name: p.full_name, first_name: p.first_name, middle_name: p.middle_name,
                last_name: p.last_name, avatar_url: p.avatar_url, handle: p.handle, sport: p.sport,
                school: p.school, location: p.location, city: p.city ?? null, region: p.region ?? null,
                country: p.country ?? null, distance_km: p.distance_km ?? null, created_at: null,
              })),
            error: null,
          };
        })
      : athleteQuery;
    const [athletesResult, postsResult] = await Promise.all([athletesPromise, postQuery]);

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
    }, {
      // Public browse surface: only public athletes/posts (private authors
      // filtered out above), and it varies by query params, not by viewer.
      // CDN-cacheable keyed on the full request URL.
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    });
  } catch (e) {
    console.error('[explore] unexpected error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
