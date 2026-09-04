import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ClubJoinDecisionSchema } from '@/lib/clubs/validate';
import { capabilityAllows, getOrgAndCapabilities } from '@/lib/orgs/authz';
import { decideJoinRequest, listJoinRequests } from '@/lib/orgs/join-requests-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/join-requests — the approval queue (phase 9 V2) ────────
// GET the queue; PATCH {requestId, decision} approves (the existing join)
// or declines. Managers only (manage_members).

async function gate(request: NextRequest, params: Promise<{ id: string }>) {
  const user = await requireAuth(request);
  const { id } = await params;
  if (!UUID_RE.test(id)) return { response: NextResponse.json({ error: 'Club not found' }, { status: 404 }) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndCapabilities(admin, 'club', id, user.id);
  if (loaded.status !== 'found') return { response: NextResponse.json({ error: 'Club not found' }, { status: 404 }) };
  const isOwnerColumn = loaded.org.owner_profile_id === user.id;
  if (!capabilityAllows(loaded.caps, 'manage_membership') && !isOwnerColumn) {
    return { response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user, admin, club: { id, name: loaded.org.name as string } };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    return await listJoinRequests(g.admin, 'club', g.club.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB JOIN REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate(request, params);
    if ('response' in g) return g.response;
    const parsed = await parseBody(request, ClubJoinDecisionSchema);
    if (!parsed.success) return parsed.response;
    return await decideJoinRequest(g.admin, 'club', g.club, parsed.data.requestId, parsed.data.decision);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB JOIN REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
