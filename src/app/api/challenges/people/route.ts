import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { challengeablePeople } from '@/lib/play/challenges-server';
import { reportRouteError } from '@/lib/observability/report';

/** GET /api/challenges/people — who the signed-in athlete may challenge: mutual follows, never across a block or a mute (the Play program, 244). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    return NextResponse.json({ people: await challengeablePeople(getSupabaseAdmin(), user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('GET challengeable people error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
