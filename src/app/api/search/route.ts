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

    console.log('[SEARCH] Query received:', query, 'Type:', type);

    if (!query || query.length < 2) {
      return NextResponse.json({
        error: 'Search query must be at least 2 characters'
      }, { status: 400 });
    }

    const results: any = {
      athletes: [],
      posts: [],
      clubs: []
    };

    // Search Athletes/Profiles
    if (type === 'all' || type === 'athletes') {
      const { data: athletes, error: athletesError } = await supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, username, avatar_url, sport, position, school, team, location, email')
        .or(`full_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,username.ilike.%${query}%,school.ilike.%${query}%,team.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(10);

      if (!athletesError && athletes) {
        results.athletes = athletes;
        console.log('[SEARCH] Athletes found:', athletes.length, 'Query:', query);
      } else if (athletesError) {
        console.error('[SEARCH] Athletes error:', athletesError);
      }
    }

    // Search Posts (by caption, hashtags, tags)
    if (type === 'all' || type === 'posts') {
      const { data: posts, error: postsError } = await supabase
        .from('posts')
        .select(`
          id,
          caption,
          sport_key,
          hashtags,
          tags,
          created_at,
          profiles (
            id,
            full_name,
            first_name,
            last_name,
            avatar_url
          ),
          post_media (
            media_url,
            media_type
          )
        `)
        .eq('visibility', 'public')
        .or(`caption.ilike.%${query}%, hashtags.cs.{${query}}`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!postsError && posts) {
        results.posts = posts;
      }
    }

    // Search Clubs
    if (type === 'all' || type === 'clubs') {
      const { data: clubs, error: clubsError } = await supabase
        .from('clubs')
        .select('id, name, description, location, logo_url')
        .or(`name.ilike.%${query}%, description.ilike.%${query}%, location.ilike.%${query}%`)
        .limit(10);

      if (!clubsError && clubs) {
        results.clubs = clubs;
      }
    }

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
