import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { readFormatConfig, readMatchConfig } from '@/lib/sport-events/format-config';
import { MATCH_REFUSAL_COPY } from '@/lib/sport-events/match';
import { fetchEventMatches, fetchRoundMatches } from '@/lib/sport-events/match-server';
import { projectMatch, type EventMatchesPayload } from '@/lib/sport-events/match-view';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET ?round=<rid>&token=&as= — the matches (Events program, phase 3):
 * every round's by default (the bracket), one round's when asked; each
 * computed on read from the cards and its row, never stored. The gate and
 * the cache rule are the leaderboard's; a stroke event answers 409
 * `not_match_play`.
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
    const roundParam = url.searchParams.get('round');
    if (roundParam !== null && !UUID_RE.test(roundParam)) return NextResponse.json({ error: 'round must be a round id' }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, viewerId, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const match = readMatchConfig(readFormatConfig(read.event.format_config, 8, read.event.format), read.event.format);
    if (!match) return NextResponse.json({ error: MATCH_REFUSAL_COPY.not_match_play, reason: 'not_match_play' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    const { data: roundRows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id).order('sequence', { ascending: true });
    const rounds = (roundRows ?? []) as SportEventRoundRow[];
    const one = roundParam ? rounds.find(r => r.id === roundParam) : null;
    if (roundParam && !one) return NextResponse.json({ error: 'Round not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const [matches, gpRows] = await Promise.all([
      one ? fetchRoundMatches(admin, read.event, one) : fetchEventMatches(admin, read.event, rounds),
      rounds.length > 0 ? admin.from('group_posts').select('id, sport_event_round_id').in('sport_event_round_id', rounds.map(r => r.id)) : Promise.resolve({ data: [] as Array<{ id: string; sport_event_round_id: string }> }),
    ]);
    const gpByRound = new Map(((gpRows.data ?? []) as Array<{ id: string; sport_event_round_id: string }>).map(g => [g.sport_event_round_id, g.id]));
    const payload: EventMatchesPayload = {
      event: { id: read.event.id, format: read.event.format, status: read.event.status, match },
      rounds: rounds.filter(r => r.status !== 'cancelled').map(r => ({ id: r.id, sequence: r.sequence, name: r.name ?? null, status: r.status, holes: r.holes, scheduled_on: r.scheduled_on, group_post_id: gpByRound.get(r.id) ?? null })),
      matches: matches.map(projectMatch),
      computed_at: new Date().toISOString(),
    };
    const cache = viewerId ? 'private, max-age=5' : 'public, max-age=5, s-maxage=10';
    return NextResponse.json(payload, { headers: { 'Cache-Control': cache } });
  } catch (error) {
    console.error('[api/sport-events/matches] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
