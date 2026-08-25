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
    
    // Counts via head:true — never fetch the rows. The old .select('id').length
    // transferred the entire follow graph per profile view AND silently capped
    // at PostgREST's 1000-row limit, so a >1000-follower account reported 1000
    // forever. (public/profile/route.ts already does it this way.)
    const [{ count: followersCountRaw, error: followersError },
           { count: followingCountRaw, error: followingError }] = await Promise.all([
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', profileId)
        .eq('status', 'accepted'),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', profileId)
        .eq('status', 'accepted'),
    ]);

    if (followersError) {
      console.error('Followers error:', followersError);
      return NextResponse.json({ error: 'Failed to get followers' }, { status: 500 });
    }
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
      followersCount: followersCountRaw ?? 0,
      followingCount: followingCountRaw ?? 0,
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