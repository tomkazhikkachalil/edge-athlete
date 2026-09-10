import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { fetchContestView, publicContestPath } from '@/lib/competitions/contest-view';

/**
 * GET /api/contests/[contestId] — the contest view for the in-app place
 * (Contest Place E1). Optional auth: a public competition's contest answers
 * signed-out; a private one answers members (resolveContestAccess, the one
 * gate). Not-found and not-allowed are the same 404 so the route never
 * confirms a private contest exists. Anonymous-reachable → IP rate limited.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contestId: string }> }
) {
  const { contestId } = await params;
  if (!UUID_RE.test(contestId)) {
    return NextResponse.json({ error: 'Contest not found' }, { status: 404 });
  }
  const limited = await enforceRateLimit(request, 'contest-view');
  if (limited) return limited;

  try {
    const { user } = await getServerAuth(request);
    const result = await fetchContestView(getSupabaseAdmin(), contestId, { viewerId: user?.id ?? null });
    if (!result) {
      return NextResponse.json({ error: 'Contest not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const publicSitePath = await publicContestPath(getSupabaseAdmin(), result);
    return NextResponse.json({ ...result, publicSitePath }, {
      headers: { 'Cache-Control': result.access === 'member' ? 'private, no-store' : 'no-store' },
    });
  } catch (error) {
    console.error('[api/contests] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
