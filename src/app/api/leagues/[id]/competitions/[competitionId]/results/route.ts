import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResultUpsertSchema } from '@/lib/competitions/validate';
import { requireCompetitionManager, resultsUpsertPOST } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/results (phase 2 R2) ─────
// Batch result entry for one contest. Provenance is stamped server-side
// in the lib ('league_verified' — the entering manager IS the
// competition owner); the contest auto-completes when every side holds
// a result.

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

    const parsed = await parseBody(request, ResultUpsertSchema);
    if (!parsed.success) return parsed.response;
    return await resultsUpsertPOST(admin, parsed.data, { side: 'league', orgId: id }, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league results POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
