import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

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
    
    // The counts are the trigger-maintained columns (229): one PK read
    // instead of two COUNT(*) over every accepted edge (Round 3). Before
    // that they were head:true counts; before THAT `.select('id').length`,
    // which transferred the whole graph and capped at 1000 silently.
    // Also the target's privacy, so FollowButton can pick the right flow:
    // public → one-click follow, private → the request modal. Not
    // sensitive — /api/privacy/check and the public-profile API reveal it.
    const { data: targetProfile, error: targetError } = await supabase
      .from('profiles')
      .select('visibility, followers_count, following_count')
      .eq('id', profileId)
      .maybeSingle();
    if (targetError) {
      reportRouteError('Follow stats target error:', targetError);
      return NextResponse.json({ error: 'Failed to get follow stats' }, { status: 500 });
    }
    const followersCountRaw = (targetProfile as { followers_count?: number | null } | null)?.followers_count ?? 0;
    const followingCountRaw = (targetProfile as { following_count?: number | null } | null)?.following_count ?? 0;

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
        reportRouteError('Follow status error:', statusError);
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
    reportRouteError('Follow stats API error:', error);
    return NextResponse.json({ error: 'Failed to get follow stats' }, { status: 500 });
  }
}