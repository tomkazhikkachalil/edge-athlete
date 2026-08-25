import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getProfileOrganizations } from '@/lib/affiliations/server';
import { UUID_RE } from '@/lib/golf/course-catalog';

/**
 * GET /api/profile/[profileId]/organizations
 *
 * The leagues and clubs a profile belongs to, with their role. Behind the
 * standard profile-visibility gate: a PRIVATE athlete's affiliation graph
 * must not be anonymously enumerable, even though org membership is public
 * for public profiles. Owner || public || accepted-follower — the same block
 * vitals/workouts/stat-lines use (supports anonymous viewers of public
 * profiles, which canViewProfile does not).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    let viewerId: string | null = null;
    try {
      const user = await requireAuth(request);
      viewerId = user.id;
    } catch {
      viewerId = null;
    }

    if (viewerId !== profileId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (!prof) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      if (prof.visibility !== 'public') {
        if (!viewerId) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
        const { data: follow } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', viewerId)
          .eq('following_id', profileId)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!follow) {
          return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        }
      }
    }

    const organizations = await getProfileOrganizations(supabase, profileId);
    return NextResponse.json({ organizations });
  } catch (e) {
    console.error('[organizations] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
