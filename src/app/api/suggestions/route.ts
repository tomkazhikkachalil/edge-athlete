import { NextRequest, NextResponse } from 'next/server';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';

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
    // Suggestions (and the follow-graph they can reveal) are personal — the
    // caller may only fetch their own. profileId must match the session user.
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && !isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 100);

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID required' }, { status: 400 });
    }
    if (profileId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      // The PostgrestError object carries code/message/details/hint whole.
      console.error('RPC generate_connection_suggestions error:', rpcError);

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

    // Blocks gate suggestions (Aug 2026): a pair with a user_blocks row in
    // either direction must never be suggested to each other. Silent filter
    // (never reveal who blocked whom).
    const candidateIds = suggestions.map(s => s.suggested_id).filter(Boolean);
    if (candidateIds.length > 0) {
      const { allowed } = await filterBlockedBidirectional(supabase, profileId, candidateIds);
      const allowedSet = new Set(allowed);
      suggestions = suggestions.filter(s => allowedSet.has(s.suggested_id));
    }

    return NextResponse.json({ suggestions });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Suggestions fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suggestions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Dismissals are written for the session user only.
    const user = await requireAuth(request);
    const body = await request.json();
    const { suggestedProfileId, action } = body;
    const profileId = user.id;

    if (!suggestedProfileId) {
      return NextResponse.json({ error: 'Suggested profile ID required' }, { status: 400 });
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
        }, { onConflict: 'profile_id,suggested_profile_id' }); // re-dismiss used to 500 on the UNIQUE constraint

      if (error) {
        return NextResponse.json({ error: 'Failed to process suggestion action' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Suggestion dismissed' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Suggestion action error:', error);
    return NextResponse.json(
      { error: 'Failed to process suggestion action' },
      { status: 500 }
    );
  }
}
