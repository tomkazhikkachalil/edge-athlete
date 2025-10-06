import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Feature flag for full-text search (set to false to use old ILIKE method)
const USE_FULLTEXT_SEARCH = true;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const type = searchParams.get('type') || 'all'; // all, athletes, posts, clubs

    // Advanced filters
    const sport = searchParams.get('sport')?.trim();
    const school = searchParams.get('school')?.trim();
    const league = searchParams.get('league')?.trim();
    const dateFrom = searchParams.get('dateFrom')?.trim();
    const dateTo = searchParams.get('dateTo')?.trim();

    console.log('[SEARCH] Query received:', query, 'Type:', type, 'Filters:', { sport, school, league, dateFrom, dateTo });

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Search query must be at least 2 characters'
      }, { status: 400 });
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

    // Search Athletes/Profiles
    if (type === 'all' || type === 'athletes') {
      try {
        if (USE_FULLTEXT_SEARCH) {
          // Use optimized full-text search function
          console.log('[SEARCH] Using full-text search for athletes');

          const { data: athletes, error: athletesError } = await supabase
            .rpc('search_profiles', {
              search_query: query,
              max_results: 20
            });

          if (!athletesError && athletes) {
            // Apply additional filters (sport, school) client-side for now
            let filtered = athletes;
            if (sport) {
              filtered = filtered.filter((a: { sport?: string }) => a.sport === sport);
            }
            if (school) {
              filtered = filtered.filter((a: { school?: string }) =>
                a.school?.toLowerCase().includes(school.toLowerCase())
              );
            }

            results.athletes = filtered.map((athlete: {
              id: string;
              full_name: string | null;
              first_name: string | null;
              middle_name: string | null;
              last_name: string | null;
              avatar_url: string | null;
              location: string | null;
              sport: string | null;
              school: string | null;
              visibility: string | null;
            }) => ({
              id: athlete.id,
              full_name: athlete.full_name,
              first_name: athlete.first_name,
              middle_name: athlete.middle_name,
              last_name: athlete.last_name,
              avatar_url: athlete.avatar_url,
              location: athlete.location,
              sport: athlete.sport,
              school: athlete.school,
              visibility: athlete.visibility
            }));
            console.log('[SEARCH] Athletes found:', athletes.length, 'After filters:', results.athletes.length);
          } else if (athletesError) {
            console.error('[SEARCH] Athletes full-text error:', athletesError);
            // Fallback to ILIKE on error
            throw athletesError;
          }
        } else {
          throw new Error('Fallback to ILIKE');
        }
      } catch (error) {
        // Fallback to ILIKE search if full-text search fails
        console.log('[SEARCH] Falling back to ILIKE search for athletes');
        const searchPattern = `%${query}%`;

        const athleteQuery = supabase
          .from('profiles')
          .select('id, full_name, first_name, middle_name, last_name, avatar_url, visibility, location, sport, school')
          .or(`full_name.ilike.${searchPattern},first_name.ilike.${searchPattern},middle_name.ilike.${searchPattern},last_name.ilike.${searchPattern},location.ilike.${searchPattern}`);

        if (sport) {
          athleteQuery.eq('sport', sport);
        }
        if (school) {
          athleteQuery.ilike('school', `%${school}%`);
        }

        const { data: athletes, error: athletesError } = await athleteQuery
          .order('full_name', { ascending: true, nullsFirst: false })
          .limit(20);

        if (!athletesError && athletes) {
          results.athletes = athletes.map(athlete => ({
            id: athlete.id,
            full_name: athlete.full_name,
            first_name: athlete.first_name,
            middle_name: athlete.middle_name,
            last_name: athlete.last_name,
            avatar_url: athlete.avatar_url,
            location: athlete.location,
            sport: athlete.sport,
            school: athlete.school,
            visibility: athlete.visibility
          }));
          console.log('[SEARCH] Athletes found (ILIKE):', athletes.length);
        } else if (athletesError) {
          console.error('[SEARCH] Athletes ILIKE error:', athletesError);
        }
      }
    }

    // Search Posts (by caption, hashtags, tags)
    if (type === 'all' || type === 'posts') {
      try {
        if (USE_FULLTEXT_SEARCH) {
          // Use optimized full-text search function
          console.log('[SEARCH] Using full-text search for posts');

          const { data: postsBasic, error: postsError } = await supabase
            .rpc('search_posts', {
              search_query: query,
              max_results: 15
            });

          if (!postsError && postsBasic) {
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
              console.log('[SEARCH] Posts found:', posts?.length || 0);
            }
          } else if (postsError) {
            console.error('[SEARCH] Posts full-text error:', postsError);
            throw postsError;
          }
        } else {
          throw new Error('Fallback to ILIKE');
        }
      } catch (error) {
        // Fallback to ILIKE search if full-text search fails
        console.log('[SEARCH] Falling back to ILIKE search for posts');
        const searchPattern = `%${query}%`;

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
          console.log('[SEARCH] Posts found (ILIKE):', posts.length);
        } else if (postsError) {
          console.error('[SEARCH] Posts ILIKE error:', postsError);
        }
      }
    }

    // Search Clubs
    if (type === 'all' || type === 'clubs') {
      try {
        if (USE_FULLTEXT_SEARCH) {
          // Use optimized full-text search function
          console.log('[SEARCH] Using full-text search for clubs');

          const { data: clubs, error: clubsError } = await supabase
            .rpc('search_clubs', {
              search_query: query,
              max_results: 10
            });

          if (!clubsError && clubs) {
            results.clubs = clubs;
            console.log('[SEARCH] Clubs found:', clubs.length);
          } else if (clubsError) {
            console.error('[SEARCH] Clubs full-text error:', clubsError);
            throw clubsError;
          }
        } else {
          throw new Error('Fallback to ILIKE');
        }
      } catch (error) {
        // Fallback to ILIKE search if full-text search fails
        console.log('[SEARCH] Falling back to ILIKE search for clubs');
        const searchPattern = `%${query}%`;

        const { data: clubs, error: clubsError } = await supabase
          .from('clubs')
          .select('id, name, description, location')
          .or(`name.ilike.${searchPattern},description.ilike.${searchPattern},location.ilike.${searchPattern}`)
          .limit(10);

        if (!clubsError && clubs) {
          results.clubs = clubs;
          console.log('[SEARCH] Clubs found (ILIKE):', clubs.length);
        } else if (clubsError) {
          console.error('[SEARCH] Clubs ILIKE error:', clubsError);
        }
      }
    }

    // Log final results
    console.log('[SEARCH] Total results:', {
      athletes: results.athletes.length,
      posts: results.posts.length,
      clubs: results.clubs.length,
      total: results.athletes.length + results.posts.length + results.clubs.length
    });

    return NextResponse.json({
      query,
      results,
      total: results.athletes.length + results.posts.length + results.clubs.length
    });

  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
