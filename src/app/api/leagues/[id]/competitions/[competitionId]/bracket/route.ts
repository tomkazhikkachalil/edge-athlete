import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { BracketGenerateSchema } from '@/lib/competitions/validate';
import { bracketGeneratePOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/bracket (track 2 PR 3) ──
// Generate the bracket from the seeded order — dry-run by default; a draw with results is never replaced.
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
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, BracketGenerateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId) {
      return NextResponse.json({ error: 'Body competition does not match the URL' }, { status: 400 });
    }
    return await bracketGeneratePOST(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league bracket POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
