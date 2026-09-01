import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { disputePATCH, type DisputeAction } from '@/lib/orgs/dispute-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/results/dispute ─────────
// Phase 6 R4 (mig 168). raise/withdraw = a manager of any org with
// standing on the contest; resolve = the owning org. The matrix lives in
// dispute-server.ts; [id] is the org whose console the caller drives.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      contestId?: unknown;
      action?: unknown;
      note?: unknown;
    };
    return await disputePATCH(getSupabaseAdmin(), user, 'league', id, competitionId, {
      contestId: typeof body.contestId === 'string' ? body.contestId : '',
      action: body.action as DisputeAction,
      note: typeof body.note === 'string' ? body.note : undefined,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[DISPUTE] league PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
