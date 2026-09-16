import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveActor } from '@/lib/sport-events/actor-server';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import { readRoundStats } from '@/lib/sport-events/stats-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET ?token=&as= — a team round's live stats (Events program, phase 4):
 * every line with its player (masked), side and headline, the game score,
 * and what the viewer may enter. Everyone who may view the event may read
 * it — signed out on a public event. Polled: a signed-in read caches
 * privately for 5 s; an anonymous read of a public event lets the CDN hold
 * it 10 s. A golf round answers 409 (`not_a_team_round`).
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
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, viewerId, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const { data: round } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('id', rid).eq('sport_event_id', id).maybeSingle();
    if (!round) return NOT_FOUND();
    const payload = await readRoundStats(admin, read.event, round as SportEventRoundRow, { profileId: viewerId, canManage: read.access.canManage });
    if (!payload) return NextResponse.json({ error: 'This is a golf round — read its leaderboard.', reason: 'not_a_team_round' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    // Never `s-maxage` here: the payload carries a VIEWER block, and Vercel's edge honours s-maxage regardless of
    // vercel.json — a cached anonymous copy was served to signed-in readers for 10 s (prod probe, Sep 16 2026).
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=5' } });
  } catch (error) {
    console.error('[api/sport-events/stats] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
