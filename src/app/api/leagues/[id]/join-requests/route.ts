import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { LeagueJoinDecisionSchema } from '@/lib/leagues/validate';
import { getOrgAndRole, roleAllows } from '@/lib/orgs/authz';
import { decideJoinRequest, listJoinRequests } from '@/lib/orgs/join-requests-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/join-requests — the approval queue (program 11 L1) ───
// The league twin of /api/clubs/[id]/join-requests: GET the queue; PATCH
// {requestId, decision} approves (the existing join) or declines. Managers
// only (manage_members).

async function gate(request: NextRequest, params: Promise<{ id: string }>) {
  const user = await requireAuth(request);
  const { id } = await params;
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ error: 'League not found' }, { status: 404 }) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndRole(admin, 'league', id, user.id);
  if (loaded.status !== 'found') return { response: NextResponse.json({ error: 'League not found' }, { status: 404 }) };
  const isOwnerColumn = loaded.org.owner_profile_id === user.id;
  if (!roleAllows(loaded.role, 'manage_members') && !isOwnerColumn) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user, admin, league: { id, name: loaded.org.name as string } };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    return await listJoinRequests(g.admin, 'league', g.league.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE JOIN REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, LeagueJoinDecisionSchema);
    if (!parsed.success) return parsed.response;
    return await decideJoinRequest(g.admin, 'league', g.league, parsed.data.requestId, parsed.data.decision);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE JOIN REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
