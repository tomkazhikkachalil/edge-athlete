import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { fetchOverallLeaderboard } from '@/lib/sport-events/leaderboard-server';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
const FLIGHT_MAX = 20;

/**
 * GET ?token=&as=&flight= — the OVERALL leaderboard (Events program, phase
 * 2): the minted rounds' boards folded into cumulative totals, computed on
 * read and never stored. Everyone who may view the event may read it — a
 * private event's followers included. `flight` ranks within one flight.
 * The cache rule is the round route's: 5 s privately signed in, 10 s at
 * the CDN for an anonymous read of a public event.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  const limited = await enforceRateLimit(request, 'sport-event-view');
  if (limited) return limited;
  try {
    const { user } = await getServerAuth(request);
    const url = new URL(request.url);
    let viewerId: string | null = user?.id ?? null;
    if (user && url.searchParams.get('as')) {
      const actor = await resolveActor(user.id, url.searchParams.get('as'));
      if (!actor.ok) return actor.response;
      viewerId = actor.profileId;
    }
    const flightParam = url.searchParams.get('flight');
    if (flightParam !== null && (flightParam.trim().length === 0 || flightParam.length > FLIGHT_MAX)) return NextResponse.json({ error: `flight must be 1 to ${FLIGHT_MAX} characters` }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, viewerId, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const { data: rounds } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id).order('sequence', { ascending: true });
    const board = await fetchOverallLeaderboard(admin, read.event, (rounds ?? []) as SportEventRoundRow[], { flight: flightParam?.trim() ?? null });
    const cache = viewerId ? 'private, max-age=5' : 'public, max-age=5, s-maxage=10';
    return NextResponse.json(board, { headers: { 'Cache-Control': cache } });
  } catch (error) {
    console.error('[api/sport-events/leaderboard] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
