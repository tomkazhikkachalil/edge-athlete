import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      // Build search pattern
      const searchPattern = `%${query}%`;

      console.log('[SEARCH] Searching athletes with pattern:', searchPattern);

      // Start building the query (only using fields that exist in all profile schemas)
      const athleteQuery = supabase
        .from('profiles')
        .select('id, full_name, first_name, middle_name, last_name, avatar_url, visibility, location')
        .or(`full_name.ilike.${searchPattern},first_name.ilike.${searchPattern},middle_name.ilike.${searchPattern},last_name.ilike.${searchPattern},location.ilike.${searchPattern}`);

      // Sport and school filters are temporarily disabled until schema is fully migrated
      // if (sport) {
      //   athleteQuery = athleteQuery.eq('sport', sport);
      // }
      // if (school) {
      //   athleteQuery = athleteQuery.ilike('school', `%${school}%`);
      // }

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
          visibility: athlete.visibility
        }));
        console.log('[SEARCH] Athletes found:', athletes.length, 'Query:', query);
      } else if (athletesError) {
        console.error('[SEARCH] Athletes error:', athletesError);
      }
    }

    // Search Posts (by caption, hashtags, tags)
    if (type === 'all' || type === 'posts') {
      const searchPattern = `%${query}%`;

      console.log('[SEARCH] Searching posts with pattern:', searchPattern);

      // Start building the query
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

      // Apply sport filter
      if (sport) {
        postQuery = postQuery.eq('sport_key', sport);
      }

      // Apply date range filters
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
        console.log('[SEARCH] Posts found:', posts.length, 'Filters applied:', { sport, dateFrom, dateTo });
      } else if (postsError) {
        console.error('[SEARCH] Posts error:', postsError);
      }
    }

    // Search Clubs
    if (type === 'all' || type === 'clubs') {
      const searchPattern = `%${query}%`;

      console.log('[SEARCH] Searching clubs with pattern:', searchPattern);

      const { data: clubs, error: clubsError } = await supabase
        .from('clubs')
        .select('id, name, description, location')
        .or(`name.ilike.${searchPattern},description.ilike.${searchPattern},location.ilike.${searchPattern}`)
        .limit(10);

      if (!clubsError && clubs) {
        results.clubs = clubs;
        console.log('[SEARCH] Clubs found:', clubs.length);
      } else if (clubsError) {
        console.error('[SEARCH] Clubs error:', clubsError);
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
