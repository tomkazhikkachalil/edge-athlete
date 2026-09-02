import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { golfMineGET } from '@/lib/competitions/golf-league-mine';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/golf/mine (phase 6d W2) ─────────────────────────────────
// "Your week": the caller's own entries in this league's golf leaderboards —
// the round the page leads with and the caller's result in it. The one
// viewer-DEPENDENT golf-league read (private, no-store); entry-gated, so
// it needs no manager role and no competition visibility. Logic lives in
// the shared core — one code path, two org kinds.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await golfMineGET(getSupabaseAdmin(), 'league', id, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GOLF LEAGUE] league mine error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
