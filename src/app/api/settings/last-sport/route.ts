import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getAllSports } from '@/lib/sports/SportRegistry';
import { lastUsedSport } from '@/lib/sports/favourite-sports';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/settings/last-sport — the sport of the caller's OWN newest sport
 * post, for the sport picker's LAST tag (Nov 23 2026). { sport: string | null }.
 *
 * Derived, never stored: one indexed read of the caller's posts through the
 * cookie-scoped client (RLS). The ACCOUNT's own posts only, like the
 * favourites — never a guardian-managed profile. Viewer-dependent, so
 * `private, no-store`. A failed read answers null: the tag is a hint, and
 * the picker works without it.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'last-sport', { userId: user.id });
    if (limited) return limited;
    const { data, error } = await supabase
      .from('posts')
      .select('sport_key')
      .eq('profile_id', user.id)
      .not('sport_key', 'is', null)
      .neq('sport_key', 'general')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      reportRouteError('[GET /api/settings/last-sport]', error);
      return NextResponse.json({ sport: null }, { headers: NO_STORE });
    }
    const sport = lastUsedSport(data?.[0]?.sport_key, getAllSports());
    return NextResponse.json({ sport }, { headers: NO_STORE });
  } catch (error) {
    reportRouteError('[GET /api/settings/last-sport]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
