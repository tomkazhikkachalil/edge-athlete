import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { GolfSeasonGenerateSchema } from '@/lib/competitions/validate';
import { golfSeasonGeneratePOST, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/golf-season (phase 6d W3) ──
// "Generate rounds": N weekly play windows from one declaration, dry-run
// by default, existing windows reused. ONE request per season, so the
// org-competitions bucket is not burned per round. Manager-gated; the
// body/URL competition mismatch guard runs BEFORE the lib call.

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
    const gate = await requireCompetitionManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, GolfSeasonGenerateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId) {
      return NextResponse.json({ error: 'Body competition does not match the URL' }, { status: 400 });
    }
    return await golfSeasonGeneratePOST(admin, parsed.data, { side: 'league', orgId: id }, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league golf-season POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
