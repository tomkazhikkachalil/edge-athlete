import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ContestPublishSchema } from '@/lib/competitions/validate';
import { contestPublishPOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── .../contests/publish — mint the contest's calendar mirror event ─────────
// Idempotent (a published contest returns its existing event id). The
// event is division- or org-scoped and rides the existing merge/RSVP/ICS
// rails; sync afterwards is one-way from the contest.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ContestPublishSchema);
    if (!parsed.success) return parsed.response;
    return await contestPublishPOST(
      admin,
      parsed.data.contestId,
      { side: 'club', orgId: id },
      user.id,
      parsed.data.timezone
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club publish POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
