import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { seasonAnnounceGET, seasonAnnouncePOST } from '@/lib/competitions/golf-season-wrap-server';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/season-announce (P6) ──
// GET: the season summary + whether it was announced. POST: announce it
// once (the announce rails — bells, guardian copies, the site notice).

async function gate(request: NextRequest, params: Promise<{ id: string; competitionId: string }>) {
  const user = await requireAuth(request);
  const { id, competitionId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { response: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const managerGate = await requireCompetitionManager(admin, user, 'league', id);
  if (!managerGate.ok) return { response: managerGate.response };
  const { data: comp } = await admin.from('competitions').select('id, league_id').eq('id', competitionId).maybeSingle();
  if (!comp || (comp as { league_id: string | null }).league_id !== id) {
    return { response: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  return { user, admin, id, competitionId };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    return await seasonAnnounceGET(g.admin, 'league', g.id, g.competitionId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SEASON WRAP] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-announce', { userId: user.id });
    if (limited) return limited;
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    return await seasonAnnouncePOST(g.admin, 'league', g.id, g.competitionId, g.user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SEASON WRAP] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
