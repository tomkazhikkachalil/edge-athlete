import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter, requireAuth, requireProfileRole } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';
import { createChallenge, listChallenges } from '@/lib/play/challenges-server';
import type { ChallengeDraft } from '@/lib/play/challenges';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/challenges — friend challenges (the Play program, 244).
 *
 * GET ?profileId=: a profile's challenges both ways — the athlete, or their
 * guardian (`read` through the role matrix). `private, no-store`.
 * POST: send one — mutual follows only, never across a block or a mute
 * (challenges-server.ts decides; a refusal never says which rule). A
 * challenge reaches another person, so it runs behind the write gate and
 * the `challenge` bucket.
 */
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const profileId = request.nextUrl.searchParams.get('profileId') ?? user.id;
    if (!isUuid(profileId)) return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    if (profileId !== user.id) await requireProfileRole(request, profileId, 'read');
    return NextResponse.json({ challenges: await listChallenges(getSupabaseAdmin(), profileId) }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('GET challenges error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'challenge', { userId: user.id });
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as Partial<ChallengeDraft> | null;
    if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const draft: ChallengeDraft = {
      challengeeId: String(body.challengeeId ?? ''),
      sportKey: String(body.sportKey ?? ''),
      metric: String(body.metric ?? ''),
      target: Number(body.target),
      days: Number(body.days),
      courseId: typeof body.courseId === 'string' ? body.courseId : null,
      holes: body.holes === 9 || body.holes === 18 ? body.holes : null,
      message: typeof body.message === 'string' ? body.message : null,
      sourceKey: typeof body.sourceKey === 'string' ? body.sourceKey : null,
    };
    const out = await createChallenge(getSupabaseAdmin(), user.id, draft);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ challenge: out.challenge }, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('POST challenges error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
