import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // Optional auth — private profiles must not surface in handle search
    // (mention/tag picker) for anyone but their owner. The search_by_handle
    // RPC runs via the admin client and does NOT filter visibility.
    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

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

    type HandleRow = {
      profile_id: string;
      handle: string;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
      sport: string | null;
      school: string | null;
      match_type: string;
    };
    const rows = (data || []) as HandleRow[];

    // The RPC doesn't return visibility — look it up and drop private profiles
    // (unless the requester owns them).
    let allowedIds = new Set<string>();
    if (rows.length > 0) {
      const ids = rows.map(r => r.profile_id);
      const { data: vis } = await supabase
        .from('profiles')
        .select('id, visibility')
        .in('id', ids);
      allowedIds = new Set(
        (vis || [])
          .filter(p => p.visibility === 'public' || p.id === viewerId)
          .map(p => p.id)
      );
    }

    const results = rows
      .filter(row => allowedIds.has(row.profile_id))
      .map(row => ({
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
    if (error instanceof Response) return error;
    console.error('Error in GET /api/handles/search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
