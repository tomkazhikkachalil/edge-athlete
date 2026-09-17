import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { MeetSessionPublishSchema } from '@/lib/competitions/validate';
import { meetSessionPublishPOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions/[competitionId]/meet/sessions/publish (leftovers PR 4) ──
// ONE calendar event for a meet session; every contest of the session shares it; a re-publish moves it.
// Manager-gated; the body/URL competition mismatch guard runs BEFORE the lib call.

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

    const parsed = await parseBody(request, MeetSessionPublishSchema);
    if (!parsed.success) return parsed.response;
    return await meetSessionPublishPOST(admin, parsed.data, { side: 'club', orgId: id }, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club meet session publish POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
