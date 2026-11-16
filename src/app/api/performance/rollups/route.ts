import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { getProfileRole, getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { readRollups } from '@/lib/performance/rollups-server';
import { verifiedFilmGames } from '@/lib/videos/video-tagged-server';
import { blockedEitherWay } from '@/lib/blocks';
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

    let viewer: User | null = null;
    try {
      viewer = await requireAuth(request);
    } catch {
      viewer = null;
    }
    const viewerId: string | null = viewer?.id ?? null;
    const admin = getSupabaseAdmin();
    // Self or guardian — the skill-cards route's rule, so the two readers
    // of the Stats tab agree (gaps round, Sep 26 2026).
    const isOwner = viewerId === profileId || (!!viewerId && (await getProfileRole(viewerId, profileId)) === 'guardian');
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
      // A block in either direction closes the numbers too (Nov 2026) — said as a private profile, never as a block.
      if (await blockedEitherWay(admin, viewerId, profileId)) return NextResponse.json({ error: 'This profile is private' }, { status: 403 });
    }

    // ?trend=<n>: the trends page wants the whole series; the tab wants ten.
    const trendParam = Number(searchParams.get('trend') ?? '');
    const trendLength = Number.isInteger(trendParam) && trendParam > 0 ? Math.min(trendParam, 2000) : undefined;
    // Verified film this viewer may open (Nov 14 2026) — read here, counted through the one same-game rule.
    // Started here and awaited inside the reader, alongside the fact rows.
    const film = verifiedFilmGames(admin, profileId, sport, viewer, isOwner);
    film.catch(() => undefined);
    const { supported, rollups } = await readRollups(admin, profileId, sport, { viewerIsOwner: isOwner, trendLength, film });
    return NextResponse.json({ supported, rollups }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[performance/rollups] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
