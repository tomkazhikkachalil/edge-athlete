import { NextRequest, NextResponse } from 'next/server';
import { concessionRefusal } from '@/lib/sport-events/match';
import { writeMatch } from '@/lib/sport-events/match-server';
import { answerMatch, openMatchWrite, refuse } from '@/lib/sport-events/match-write-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST {hole: n | null, side: 1 | 2, version} — a side GIVES a hole (the
 * other side wins it, whatever the scores) or the match (`hole: null` —
 * decided at once, `decided_by 'concession'`). A member of `side`, or an
 * organizer. The refusals are the engine's (`concessionRefusal`); the write
 * is a compare-and-set on `version` (409 `conflict` = re-read and replay —
 * a concession is not a score: no keep-mine / keep-theirs).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const opened = await openMatchWrite(request, params);
    if (!opened.ok) return opened.response;
    const { admin, match, body, actorProfileId, canManage, mySide, version } = opened.ctx;
    const side = body.side;
    if (side !== 1 && side !== 2) return NextResponse.json({ error: 'side must be 1 or 2' }, { status: 400 });
    const hole = body.hole === null || body.hole === undefined ? null : body.hole;
    if (hole !== null && (typeof hole !== 'number' || !Number.isInteger(hole))) return NextResponse.json({ error: 'hole must be a hole number, or null for the match' }, { status: 400 });
    if (!canManage && mySide !== side) return refuse('not_a_side', 403);
    const refusal = concessionRefusal(match.state, match.input, { hole });
    if (refusal) return refuse(refusal, refusal === 'match_decided' ? 409 : 400);
    const now = new Date().toISOString();
    const concessions = [...match.input.concessions, { hole, by_side: side, by: actorProfileId, at: now }];
    const patch: Record<string, unknown> = { concessions };
    if (hole === null) Object.assign(patch, { decided_by: 'concession', winner_side: side === 1 ? 2 : 1, result: 'conceded', decided_at: now });
    const outcome = await writeMatch(admin, match.id, version, patch);
    if (outcome === 'conflict') return refuse('conflict', 409);
    if (outcome === 'error') return NextResponse.json({ error: 'Could not save the concession' }, { status: 500 });
    return answerMatch(opened.ctx);
  } catch (error) {
    reportRouteError('[api/sport-events/matches/concede] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
