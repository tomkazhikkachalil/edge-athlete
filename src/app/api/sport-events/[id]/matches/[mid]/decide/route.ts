import { NextRequest, NextResponse } from 'next/server';
import { writeMatch } from '@/lib/sport-events/match-server';
import { answerMatch, openMatchWrite, refuse } from '@/lib/sport-events/match-write-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST {winner_side: 1 | 2 | null, version} — the organizer decides an
 * open match (`decided_by 'organizer'`; no free-text note — no column, the
 * leak tests' rule) or clears their own decision (`null`; concessions
 * stay and the holes decide again). Organizers only; a match decided by
 * a concession or a bye is not theirs to clear. A compare-and-set on
 * `version`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const opened = await openMatchWrite(request, params);
    if (!opened.ok) return opened.response;
    const { admin, match, body, canManage, version } = opened.ctx;
    if (!canManage) return NextResponse.json({ error: 'Only an organizer can decide a match.' }, { status: 403 });
    const winner = body.winner_side;
    if (winner !== 1 && winner !== 2 && winner !== null) return NextResponse.json({ error: 'winner_side must be 1, 2 or null' }, { status: 400 });
    const stored = match.stored.decided_by;
    if (winner === null) {
      if (stored !== 'organizer') return refuse('not_organizer_decision', 409);
      const outcome = await writeMatch(admin, match.id, version, { decided_by: null, winner_side: null, result: null, decided_at: null });
      if (outcome === 'conflict') return refuse('conflict', 409);
      if (outcome === 'error') return NextResponse.json({ error: 'Could not clear the decision' }, { status: 500 });
      return answerMatch(opened.ctx);
    }
    if (stored !== null && stored !== 'organizer') return refuse('match_decided', 409);
    const outcome = await writeMatch(admin, match.id, version, { decided_by: 'organizer', winner_side: winner, result: 'decided', decided_at: new Date().toISOString() });
    if (outcome === 'conflict') return refuse('conflict', 409);
    if (outcome === 'error') return NextResponse.json({ error: 'Could not save the decision' }, { status: 500 });
    return answerMatch(opened.ctx);
  } catch (error) {
    reportRouteError('[api/sport-events/matches/decide] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
