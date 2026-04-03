import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';

// Type for suggestions returned by the RPC function
interface ConnectionSuggestion {
  suggested_id: string;
  suggested_name: string;
  suggested_avatar: string | null;
  suggested_sport: string | null;
  suggested_school: string | null;
  suggested_location: string | null;
  similarity_score: number;
  reason: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let suggestions: ConnectionSuggestion[] = [];

    // Try the RPC function first
    const { data: rpcSuggestions, error: rpcError } = await supabase
      .rpc('generate_connection_suggestions', {
        p_user_profile_id: profileId,
        p_suggestion_limit: limit
      });

    if (rpcError) {
      // Log the specific error for debugging
      console.error('RPC generate_connection_suggestions error:', {
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint
      });

      // Fallback: Get profiles that user doesn't follow
      // First get who the user already follows
      const { data: following } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', profileId);

      const followingIds = following?.map(f => f.following_id) || [];
      followingIds.push(profileId); // Exclude self

      // Get profiles not in following list
      let query = supabase
        .from('profiles')
        .select('id, full_name, first_name, last_name, avatar_url, sport, school, location')
        .eq('visibility', 'public')
        .limit(limit);

      // Only add the "not in" filter if there are IDs to exclude
      if (followingIds.length > 0) {
        query = query.not('id', 'in', `(${followingIds.join(',')})`);
      }

      const { data: fallbackSuggestions, error: fallbackError } = await query;

      if (fallbackError) {
        console.error('Fallback suggestions error:', fallbackError);
        return NextResponse.json({ suggestions: [] });
      }

      // Normalize fallback data to match expected format
      suggestions = (fallbackSuggestions || []).map(profile => ({
        suggested_id: profile.id,
        suggested_name: profile.full_name ||
          [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
          'Unknown',
        suggested_avatar: profile.avatar_url,
        suggested_sport: profile.sport,
        suggested_school: profile.school,
        suggested_location: profile.location,
        similarity_score: 0,
        reason: 'Suggested for you'
      }));
    } else {
      // Use RPC results directly - they already match our interface
      suggestions = rpcSuggestions || [];
    }

    return NextResponse.json({ suggestions });

  } catch (error) {
    console.error('Suggestions fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch suggestions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileId, suggestedProfileId, action } = body;

    if (!profileId || !suggestedProfileId) {
      return NextResponse.json({ error: 'Profile IDs required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (action === 'dismiss') {
      // Dismiss a suggestion
      const { error } = await supabase
        .from('connection_suggestions')
        .upsert({
          profile_id: profileId,
          suggested_profile_id: suggestedProfileId,
          dismissed: true,
          dismissed_at: new Date().toISOString()
        });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Suggestion dismissed' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Suggestion action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process suggestion action' },
      { status: 500 }
    );
  }
}
