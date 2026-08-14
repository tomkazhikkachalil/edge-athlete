import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { searchPeople } from '@/lib/search/people-server';

// Minimum query length, per kind of result.
//
// People suggest from the FIRST keystroke: migration 087 makes a 1-character
// prefix an index range scan, and a name prefix is exactly what someone means
// by one letter. Post and club search stays at 2 — they run on full-text over
// free-form prose, where one letter matches near-arbitrarily.
const PEOPLE_MIN_CHARS = 1;
const CONTENT_MIN_CHARS = 2;

// Sanitize user input for use in PostgREST .or() / .ilike() filters.
// Escapes characters that could break out of the filter expression.
function sanitizeForFilter(input: string): string {
  return input.replace(/[\\%_(),."']/g, '\\$&');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // Optional auth — search is public, but private profiles must not appear
    // in results for anyone but their owner. Everything here runs on the
    // RLS-bypassing admin client, so visibility is this route's job to decide:
    // it passes the audience into search_people (athletes) and filters post
    // authors below. What changed in 087 is only WHERE the athlete filter is
    // applied — inside the query, so the LIMIT lands after it.
    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const type = searchParams.get('type') || 'all'; // all, athletes, posts, clubs

    // Advanced filters
    const sport = searchParams.get('sport')?.trim();
    const school = searchParams.get('school')?.trim();
    // const league = searchParams.get('league')?.trim(); // Reserved for future implementation
    const dateFrom = searchParams.get('dateFrom')?.trim();
    const dateTo = searchParams.get('dateTo')?.trim();


    // An empty query is "nothing typed yet", not a client error. The old 400
    // under 2 characters made every typeahead in the app either wait for a
    // second keystroke or log a guaranteed failure on the first one.
    if (!query || query.length < PEOPLE_MIN_CHARS) {
      return NextResponse.json({
        query: query ?? '',
        results: { athletes: [], posts: [], clubs: [] },
        total: 0
      });
    }

    const results: {
      athletes: unknown[];
      posts: unknown[];
      clubs: unknown[];
    } = {
      athletes: [],
      posts: [],
      clubs: []
    };

    // ── Athletes ────────────────────────────────────────────────────────────
    // Ranked, indexed and prefix-first via search_people (migration 087).
    //
    // This replaces the old search_profiles RPC, which matched with
    // websearch_to_tsquery — WHOLE WORDS ONLY, so 'Tho' never found 'Thomas'
    // and the common two-letter inputs ('to', 'in', 'is') were English STOP
    // WORDS that matched nothing at all. Its ILIKE fallback never rescued
    // either case because it only ran when the RPC THREW, not when it came
    // back empty. It also never returned `handle`, so @handles were
    // unsearchable and every row here carried handle: null.
    //
    // The visibility filter now lives INSIDE the query rather than running
    // over the results afterwards, so the LIMIT lands after privacy instead
    // of before it — private profiles no longer consume result slots and push
    // public matches off the end.
    if (type === 'all' || type === 'athletes') {
      // sport/school are post-filters over the ranked set, so widen the
      // window when one is active or the filter could empty a full page.
      const hasFacets = Boolean(sport || school);
      let athletes = await searchPeople({
        query,
        visibleIds: viewerId ? [viewerId] : [],
        includePublic: true,
        limit: hasFacets ? 100 : 20,
      });

      if (sport) {
        athletes = athletes.filter(a => a.sport === sport);
      }
      if (school) {
        const needle = school.toLowerCase();
        athletes = athletes.filter(a => a.school?.toLowerCase().includes(needle));
      }

      results.athletes = hasFacets ? athletes.slice(0, 20) : athletes;
    }

    // Search Posts (by caption, hashtags, tags)
    if ((type === 'all' || type === 'posts') && query.length >= CONTENT_MIN_CHARS) {
      try {
        {
          const { data: postsBasic, error: postsError } = await supabase
            .rpc('search_posts', {
              search_query: query,
              max_results: 15
            });

          // An EMPTY result is a fallback trigger, not an answer. search_posts
          // runs websearch_to_tsquery, so a stop word ('to', 'in', 'is') or a
          // partial word compiles to a query that matches nothing — the ILIKE
          // path below finds it. Previously only a thrown error got here,
          // which is why those queries returned nothing forever.
          if (postsError || !postsBasic || postsBasic.length === 0) {
            if (postsError) console.error('[SEARCH] Posts full-text error:', postsError);
            throw postsError ?? new Error('no full-text post matches');
          }

          {
            // Fetch full post details with profile and media
            const postIds = postsBasic.map((p: { id: string }) => p.id);

            if (postIds.length > 0) {
              let postQuery = supabase
                .from('posts')
                .select(`
                  id,
                  caption,
                  sport_key,
                  hashtags,
                  tags,
                  created_at,
                  profile:profile_id (
                    id,
                    full_name,
                    first_name,
                    middle_name,
                    last_name,
                    avatar_url
                  ),
                  post_media (
                    media_url,
                    media_type
                  )
                `)
                .in('id', postIds);

              // Flag-gated: posts.status doesn't exist until migration 051.
              if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
                postQuery = postQuery.eq('status', 'published');
              }

              // Apply filters
              if (sport) {
                postQuery = postQuery.eq('sport_key', sport);
              }
              if (dateFrom) {
                postQuery = postQuery.gte('created_at', dateFrom);
              }
              if (dateTo) {
                postQuery = postQuery.lte('created_at', `${dateTo}T23:59:59.999Z`);
              }

              const { data: posts } = await postQuery
                .order('created_at', { ascending: false });

              results.posts = posts || [];
            }
          }
        }
      } catch {
        // Fallback: substring match on the caption. Reached when the RPC
        // errored OR returned nothing (see above).
        // sanitizeForFilter was missing here while every sibling path had it —
        // this one built its pattern from raw input.
        const searchPattern = `%${sanitizeForFilter(query)}%`;

        let postQuery = supabase
          .from('posts')
          .select(`
            id,
            caption,
            sport_key,
            hashtags,
            tags,
            created_at,
            profile:profile_id (
              id,
              full_name,
              first_name,
              middle_name,
              last_name,
              avatar_url
            ),
            post_media (
              media_url,
              media_type
            )
          `)
          .eq('visibility', 'public')
          .ilike('caption', searchPattern);

        // Flag-gated: posts.status doesn't exist until migration 051.
        if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
          postQuery = postQuery.eq('status', 'published');
        }

        if (sport) {
          postQuery = postQuery.eq('sport_key', sport);
        }
        if (dateFrom) {
          postQuery = postQuery.gte('created_at', dateFrom);
        }
        if (dateTo) {
          postQuery = postQuery.lte('created_at', `${dateTo}T23:59:59.999Z`);
        }

        const { data: posts, error: postsError } = await postQuery
          .order('created_at', { ascending: false })
          .limit(15);

        if (!postsError && posts) {
          results.posts = posts;
        } else if (postsError) {
          console.error('[SEARCH] Posts ILIKE error:', postsError);
        }
      }
    }

    // Search Clubs
    if ((type === 'all' || type === 'clubs') && query.length >= CONTENT_MIN_CHARS) {
      try {
        {
          const { data: clubs, error: clubsError } = await supabase
            .rpc('search_clubs', {
              search_query: query,
              max_results: 10
            });

          // Same stop-word/partial-word trap as posts: empty falls through to
          // the substring path rather than being reported as "no clubs".
          if (clubsError || !clubs || clubs.length === 0) {
            if (clubsError) console.error('[SEARCH] Clubs full-text error:', clubsError);
            throw clubsError ?? new Error('no full-text club matches');
          }
          results.clubs = clubs;
        }
      } catch {
        // Fallback to ILIKE search if full-text search fails
        const safeClubQuery = sanitizeForFilter(query);
        const searchPattern = `%${safeClubQuery}%`;

        const { data: clubs, error: clubsError } = await supabase
          .from('clubs')
          .select('id, name, description, location')
          .or(`name.ilike.${searchPattern},description.ilike.${searchPattern},location.ilike.${searchPattern}`)
          .limit(10);

        if (!clubsError && clubs) {
          results.clubs = clubs;
        } else if (clubsError) {
          console.error('[SEARCH] Clubs ILIKE error:', clubsError);
        }
      }
    }

    // NOTE: athletes need no privacy pass here any more. search_people applies
    // `visibility = 'public' OR id = ANY(visible_ids)` inside the query, so the
    // LIMIT lands after the filter. Filtering here instead (as this route used
    // to) let private profiles consume slots in the top 20 and silently drop
    // public matches off the end.

    // Privacy filter for POSTS: drop posts authored by private profiles
    // unless the viewer is the author or an accepted follower. The RPC/ILIKE
    // paths only check post-level visibility, so a private athlete's posts
    // (post visibility defaults to 'public') would otherwise leak with
    // caption, author, and media while the athlete themselves is hidden.
    const postList = results.posts as Array<{ profile?: { id?: string } | null }>;
    const authorIds = [...new Set(postList.map(p => p.profile?.id).filter((id): id is string => !!id))];
    if (authorIds.length > 0) {
      const { data: authorProfiles } = await supabase
        .from('profiles')
        .select('id, visibility')
        .in('id', authorIds);
      const privateAuthors = new Set(
        (authorProfiles || []).filter(a => a.visibility !== 'public').map(a => a.id)
      );
      if (viewerId) privateAuthors.delete(viewerId);

      let followedPrivate = new Set<string>();
      if (viewerId && privateAuthors.size > 0) {
        const { data: myFollows } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', viewerId)
          .eq('status', 'accepted')
          .in('following_id', [...privateAuthors]);
        followedPrivate = new Set((myFollows || []).map(f => f.following_id));
      }

      results.posts = postList.filter(p => {
        const authorId = p.profile?.id;
        if (!authorId) return false; // unresolvable author — don't leak
        return !privateAuthors.has(authorId) || followedPrivate.has(authorId);
      }) as typeof results.posts;
    }

    return NextResponse.json({
      query,
      results,
      total: results.athletes.length + results.posts.length + results.clubs.length
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
