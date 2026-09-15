import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { fetchBreakdown } from '@/lib/sport-events/breakdown-server';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET ?round=all|<rid>&participant=<pid>&token=&as= — the breakdowns
 * (Events program, phase 2): every minted round's cards with the five hole
 * fields, per player per round, the tournament aggregate and the hardest
 * holes. Its own route, not `?detail=1` on the polled board: the board is
 * fetched every few seconds by every viewer and cached; the breakdown
 * carries every hole of every card and is fetched once per window. The
 * gate and the cache rule are the board's.
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
    const roundParam = url.searchParams.get('round') ?? 'all';
    if (roundParam !== 'all' && !UUID_RE.test(roundParam)) return NextResponse.json({ error: 'round must be all or a round id' }, { status: 400 });
    const participant = url.searchParams.get('participant');
    if (participant !== null && !UUID_RE.test(participant)) return NextResponse.json({ error: 'participant must be a participant id' }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, viewerId, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const { data: rounds } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id).order('sequence', { ascending: true });
    const data = await fetchBreakdown(admin, read.event, (rounds ?? []) as SportEventRoundRow[], { round: roundParam, participant });
    const cache = viewerId ? 'private, max-age=5' : 'public, max-age=5, s-maxage=10';
    return NextResponse.json(data, { headers: { 'Cache-Control': cache } });
  } catch (error) {
    console.error('[api/sport-events/breakdown] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
