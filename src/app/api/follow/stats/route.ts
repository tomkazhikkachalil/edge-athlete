import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const currentUserId = searchParams.get('currentUserId');
    
    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }
    
    // Get follower count (people following this profile) - only count accepted
    const { data: followers, error: followersError } = await supabase
      .from('follows')
      .select('id')
      .eq('following_id', profileId)
      .eq('status', 'accepted');

    if (followersError) {
      console.error('Followers error:', followersError);
      return NextResponse.json({ error: 'Failed to get followers' }, { status: 500 });
    }

    // Get following count (people this profile follows) - only count accepted
    const { data: following, error: followingError } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', profileId)
      .eq('status', 'accepted');

    if (followingError) {
      console.error('Following error:', followingError);
      return NextResponse.json({ error: 'Failed to get following' }, { status: 500 });
    }

    // Check if current user follows this profile (any status)
    let isFollowing = false;
    let followStatus = null;
    if (currentUserId && currentUserId !== profileId) {
      const { data: follow, error: statusError } = await supabase
        .from('follows')
        .select('id, status')
        .eq('follower_id', currentUserId)
        .eq('following_id', profileId)
        .maybeSingle();

      if (statusError) {
        console.error('Follow status error:', statusError);
      } else if (follow) {
        isFollowing = true;
        followStatus = follow.status;
      }
    }
    
    return NextResponse.json({
      followersCount: followers?.length || 0,
      followingCount: following?.length || 0,
      isFollowing,
      followStatus
    });
    
  } catch (error) {
    console.error('Follow stats API error:', error);
    return NextResponse.json({ error: 'Failed to get follow stats' }, { status: 500 });
  }
}