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
    
    // Get follower count (people following this profile)
    const { data: followers, error: followersError } = await supabase
      .from('follows')
      .select('id')
      .eq('following_id', profileId);
    
    if (followersError) {
      console.error('Followers error:', followersError);
      return NextResponse.json({ error: 'Failed to get followers' }, { status: 500 });
    }
    
    // Get following count (people this profile follows)
    const { data: following, error: followingError } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', profileId);
    
    if (followingError) {
      console.error('Following error:', followingError);
      return NextResponse.json({ error: 'Failed to get following' }, { status: 500 });
    }
    
    // Check if current user follows this profile
    let isFollowing = false;
    if (currentUserId && currentUserId !== profileId) {
      const { data: followStatus, error: statusError } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', currentUserId)
        .eq('following_id', profileId)
        .single();
      
      if (statusError && statusError.code !== 'PGRST116') {
        console.error('Follow status error:', statusError);
      } else if (followStatus) {
        isFollowing = true;
      }
    }
    
    return NextResponse.json({
      followersCount: followers?.length || 0,
      followingCount: following?.length || 0,
      isFollowing
    });
    
  } catch (error) {
    console.error('Follow stats API error:', error);
    return NextResponse.json({ error: 'Failed to get follow stats' }, { status: 500 });
  }
}