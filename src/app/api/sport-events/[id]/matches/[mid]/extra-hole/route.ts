import { NextRequest, NextResponse } from 'next/server';
import { extraHoleRefusal } from '@/lib/sport-events/match';
import { writeMatch } from '@/lib/sport-events/match-server';
import { answerMatch, openMatchWrite, refuse } from '@/lib/sport-events/match-write-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST {n, hole_number?, strokes: {participantId: n | null}, version} — a
 * sudden-death extra hole after all square on the last (never a card
 * hole: `golf_hole_scores` is CHECK 1..18, UNIQUE per card). Any member
 * of the match or an organizer; `n` must be the next; `hole_number`
 * defaults to the engine's (the round's holes in order from the first);
 * `strokes` names the counting players only. A compare-and-set on
 * `version`. The outcome is written at round completion, never here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const opened = await openMatchWrite(request, params);
    if (!opened.ok) return opened.response;
    const { admin, match, body, version } = opened.ctx;
    const n = body.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return NextResponse.json({ error: 'n must be the extra hole number (1..)' }, { status: 400 });
    const holeNumber = body.hole_number === undefined || body.hole_number === null ? match.state.nextExtraHole?.hole_number ?? null : body.hole_number;
    if (typeof holeNumber !== 'number' || !Number.isInteger(holeNumber)) return NextResponse.json({ error: 'hole_number must be a hole number' }, { status: 400 });
    const strokesRaw = body.strokes;
    if (typeof strokesRaw !== 'object' || strokesRaw === null || Array.isArray(strokesRaw)) return NextResponse.json({ error: 'strokes must be an object of participant id → strokes' }, { status: 400 });
    const strokes: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(strokesRaw as Record<string, unknown>)) {
      if (v !== null && typeof v !== 'number') return refuse('bad_strokes');
      strokes[k] = v as number | null;
    }
    const refusal = extraHoleRefusal(match.state, match.input, { n, hole_number: holeNumber, strokes });
    if (refusal) return refuse(refusal, refusal === 'match_decided' ? 409 : 400);
    const extra_holes = [...match.input.extraHoles.filter(e => e.n !== n), { n, hole_number: holeNumber, strokes }].sort((a, b) => a.n - b.n);
    const outcome = await writeMatch(admin, match.id, version, { extra_holes });
    if (outcome === 'conflict') return refuse('conflict', 409);
    if (outcome === 'error') return NextResponse.json({ error: 'Could not save the extra hole' }, { status: 500 });
    return answerMatch(opened.ctx);
  } catch (error) {
    reportRouteError('[api/sport-events/matches/extra-hole] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
