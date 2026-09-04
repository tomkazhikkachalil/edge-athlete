import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ContestPublishSeasonSchema } from '@/lib/competitions/validate';
import { contestPublishSeasonPOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── .../contests/publish-season (phase 6e S4) — every unpublished round ────
// A golf league's season lands on members' calendars as all-day play
// windows (timed games publish as before). Idempotent: a second call
// publishes zero. Manager-gated; the org-competitions bucket.

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
    const gate = await requireCompetitionManager(admin, user, 'club', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ContestPublishSeasonSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId) {
      return NextResponse.json({ error: 'Body competition does not match the URL' }, { status: 400 });
    }
    return await contestPublishSeasonPOST(admin, competitionId, { side: 'club', orgId: id }, user.id, parsed.data.timezone);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club publish-season POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
