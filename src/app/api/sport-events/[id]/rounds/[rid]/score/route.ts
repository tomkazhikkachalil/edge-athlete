import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { parseScoreWrite } from '@/lib/sport-events/game';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import { scoreWriteRight } from '@/lib/sport-events/stats-authz';
import { scoreOf, writeGameScore } from '@/lib/sport-events/stats-server';
import { shapeOf, type SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404 });

/**
 * PUT {side1_score, side2_score, period?, expected_version} — the game's
 * live score ON the round (Events program, phase 4, 215). A recorder's or
 * an organizer's (`scoreWriteRight`; live only, completed → organizers).
 * A compare-and-set on `score_version`; a lost race is a 409 with the
 * current score. Not a game → 409 `not_a_game`.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    if (shapeOf(read.event) !== 'game') return NextResponse.json({ error: 'Only a game keeps a score.', reason: 'not_a_game' }, { status: 409 });
    const [{ data: roundRow }, { data: own }] = await Promise.all([
      admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('id', rid).eq('sport_event_id', id).maybeSingle(),
      admin.from('sport_event_participants').select('id, status, recorder').eq('sport_event_id', id).eq('profile_id', actor.profileId).maybeSingle(),
    ]);
    if (!roundRow) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    const round = roundRow as SportEventRoundRow;
    const recorder = !!own && own.status === 'accepted' && (own as { recorder?: boolean }).recorder === true;
    const right = scoreWriteRight({ eventRole: read.access.role, recorder, roundStatus: round.status });
    if (!right.allowed) return NextResponse.json({ error: right.error, ...(right.reason ? { reason: right.reason } : {}) }, { status: right.status });

    const { profile_id: _ignored, ...rest } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    void _ignored;
    const parsed = parseScoreWrite(rest);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { expected_version, ...score } = parsed.value;
    const outcome = await writeGameScore(admin, rid, expected_version, score);
    if (outcome === 'error') return NextResponse.json({ error: 'Could not save the score' }, { status: 500 });
    if (outcome === 'conflict') {
      const { data: now } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('id', rid).maybeSingle();
      return NextResponse.json({ error: 'The score changed under you.', reason: 'conflict', current: now ? scoreOf(now as SportEventRoundRow) : null }, { status: 409 });
    }
    return NextResponse.json({ score: { ...score, version: expected_version + 1 }, via: right.via }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/score] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
