import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

/**
 * All-time Tagged-tab summary: hero-tile numbers plus the REAL sport/year
 * filter options (the tab used to offer the entire sport registry and
 * 2000–now). Backed by get_profile_tagged_summary (migration 066), which
 * applies the same viewer + post-owner visibility rules as the tagged list.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Optional auth — anonymous viewers are a supported state.
    const { user } = await getServerAuth(request);
    const viewerId = user?.id || null;

    const { profileId } = await params;
    if (!profileId || !isUuid(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Same profile-level gate as the media GET: blocked viewers of a private
    // profile get silent zeros, matching the empty item list they'd receive.
    if (viewerId !== profileId) {
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (!targetProfile) {
        return NextResponse.json({ timesTagged: 0, taggerCount: 0, sportKeys: [], years: [] });
      }
      if (targetProfile.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) {
          return NextResponse.json({ timesTagged: 0, taggerCount: 0, sportKeys: [], years: [] });
        }
      }
    }

    const { data, error } = await supabaseAdmin.rpc('get_profile_tagged_summary', {
      target_profile_id: profileId,
      viewer_id: viewerId,
    });

    if (error) {
      // Same graceful degradation as the counts endpoint: pre-066 the RPC
      // doesn't exist; zeros keep the tab rendering (hero shows 0s).
      console.error('tagged summary RPC failed (returning zeros):', error.message);
      return NextResponse.json({ timesTagged: 0, taggerCount: 0, sportKeys: [], years: [], degraded: true });
    }

    const row = data && data.length > 0 ? data[0] : null;
    return NextResponse.json({
      timesTagged: Number(row?.times_tagged ?? 0),
      taggerCount: Number(row?.tagger_count ?? 0),
      sportKeys: row?.sport_keys ?? [],
      years: (row?.years ?? []).slice().sort((a: number, b: number) => b - a),
    });
  } catch (error) {
    console.error('Error in tagged summary API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
