import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { readRollups } from '@/lib/performance/rollups-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/performance/rollups?profileId=…&sport=ice_hockey
 *
 * Career and season rollups from `athlete_performances` — the Stats tab's
 * second reader (Round 3, Sep 2026). The gate is /api/sports/stat-lines's:
 * the owner, or a public profile, or an accepted follower of a private one;
 * a non-owner's view re-checks every post-origin row against the post's
 * visibility (rollups-server). Viewer-DEPENDENT, so never a shared cache
 * (the edge-cache trap): `private, max-age=60`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const sport = searchParams.get('sport');
    if (!profileId) return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    if (!sport || !getStatSchema(sport)) return NextResponse.json({ error: 'Unknown or unsupported sport' }, { status: 400 });

    let viewerId: string | null = null;
    try {
      viewerId = (await requireAuth(request)).id;
    } catch {
      viewerId = null;
    }
    const admin = getSupabaseAdmin();
    const isOwner = viewerId === profileId;
    if (!isOwner) {
      const { data: prof } = await admin.from('profiles').select('visibility').eq('id', profileId).single();
      if (!prof) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      if (prof.visibility !== 'public') {
        if (!viewerId) return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
        const { data: follow } = await admin
          .from('follows')
          .select('id')
          .eq('follower_id', viewerId)
          .eq('following_id', profileId)
          .eq('status', 'accepted')
          .maybeSingle();
        if (!follow) return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
      }
    }

    const { supported, rollups } = await readRollups(admin, profileId, sport, { viewerIsOwner: isOwner });
    return NextResponse.json({ supported, rollups }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[performance/rollups] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
