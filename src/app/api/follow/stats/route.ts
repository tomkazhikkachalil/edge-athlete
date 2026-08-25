import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');

    // The "do I follow this profile" relationship is about the SESSION user —
    // never a spoofable query param (that let anyone probe A-follows-B).
    // Counts themselves are public, so auth is optional.
    let currentUserId: string | null = null;
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      currentUserId = null;
    }

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }
    // Malformed input is the caller's error, not a server failure — without
    // this, a non-UUID reached Postgres and surfaced as a 500.
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId' }, { status: 400 });
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

    // Target's privacy, so FollowButton can pick the right flow: public →
    // one-click follow, private → the request modal. Not sensitive —
    // /api/privacy/check and the public-profile API already reveal it.
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('visibility')
      .eq('id', profileId)
      .maybeSingle();

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
      followStatus,
      // Missing profile reads as private: the fail-safe direction is the
      // request flow, never a silent instant follow.
      isPrivate: targetProfile ? targetProfile.visibility === 'private' : true
    });
    
  } catch (error) {
    console.error('Follow stats API error:', error);
    return NextResponse.json({ error: 'Failed to get follow stats' }, { status: 500 });
  }
}