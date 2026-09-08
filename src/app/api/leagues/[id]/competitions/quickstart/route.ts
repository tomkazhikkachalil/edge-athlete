import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { GolfQuickstartSchema } from '@/lib/competitions/validate';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { golfQuickstartPOST } from '@/lib/orgs/golf-quickstart-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/quickstart (Onboarding v2 R4) ────────────
// "Start our season": one POST composes the implicit season, a golf
// leaderboard (gross, first-posted, any course unless a venue is named),
// every roster athlete's entry (the actor included), activation and the
// weekly windows — the existing server functions, in order. Idempotent.
// Manager-gated like every competition write; ONE request per season, so
// the org-competitions bucket is not burned per step.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, GolfQuickstartSchema);
    if (!parsed.success) return parsed.response;
    return await golfQuickstartPOST(admin, user, { side: 'league', orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league quickstart POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
