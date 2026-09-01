import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { externalCompetitionsGET } from '@/lib/orgs/stat-lines-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions/external (phase 4 R1) ──────────────────────
// Competitions this club's teams hold APPROVED entries in but the club
// does not own — the doorway to the participant player-stats surface.
// Club-side only: leagues never enter foreign competitions (the R4 rule).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    return await externalCompetitionsGET(admin, id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STAT LINES] external competitions GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
