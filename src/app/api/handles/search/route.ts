import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    if (!query) {
      return NextResponse.json([]);
    }

    // Call the database function to search handles
    const { data, error } = await supabase
      .rpc('search_by_handle', {
        search_term: query,
        max_results: Math.min(limit, 50) // Cap at 50
      });

    if (error) {
      console.error('Error searching handles:', error);
      return NextResponse.json(
        { error: 'Failed to search handles' },
        { status: 500 }
      );
    }

    // Transform to match frontend expectations
    const results = (data || []).map((row: {
      profile_id: string;
      handle: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
      sport: string | null;
      school: string | null;
      match_type: string;
    }) => ({
      id: row.profile_id,
      handle: row.handle,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      sport: row.sport,
      school: row.school,
      matchType: row.match_type
    }));

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in GET /api/handles/search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
