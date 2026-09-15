import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { fetchRoundLeaderboard } from '@/lib/sport-events/leaderboard-server';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import { isMatchFormat, type SportEventRoundRow } from '@/lib/sport-events/types';
import { MATCH_REFUSAL_COPY } from '@/lib/sport-events/match';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
const FLIGHT_MAX = 20;

/**
 * GET ?token=&as=&flight= — the round's leaderboard, computed on read
 * (never stored). Everyone who may view the event may read it — a private
 * event's followers included (Tom). `flight` ranks within one flight
 * (phase 2). A signed-in read caches privately for 5 s; an anonymous read
 * of a public event lets the CDN hold it 10 s.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NOT_FOUND();
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
    // Phase 3: a match event has no gross board — an old bell's deep link never renders one.
    if (isMatchFormat(read.event.format)) return NextResponse.json({ error: MATCH_REFUSAL_COPY.not_stroke_play, reason: 'not_stroke_play' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    const { data: round } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('id', rid).eq('sport_event_id', id).maybeSingle();
    if (!round) return NOT_FOUND();
    const board = await fetchRoundLeaderboard(admin, read.event, round as SportEventRoundRow, { flight: flightParam?.trim() ?? null });
    const cache = viewerId ? 'private, max-age=5' : 'public, max-age=5, s-maxage=10';
    return NextResponse.json(board, { headers: { 'Cache-Control': cache } });
  } catch (error) {
    console.error('[api/sport-events/leaderboard] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
