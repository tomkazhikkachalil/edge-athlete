import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseClaimDecision } from '@/lib/videos/tag-claims';
import { decideClaim } from '@/lib/videos/video-claims-server';
import { readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Request not found' }, { status: 404, headers: PRIVATE });

/**
 * A manager of the video decides a "this is me" request (round 2 PR 4).
 * PATCH {action: 'approve', target: {name} | {profile_id}} → the tags under
 * that typed name, or that placeholder player's, become the requester's
 * across the owner's videos. PATCH {action: 'decline'} → nothing moves.
 * → {status, linked, videos}.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; claimId: string }> }) {
  const { id, claimId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(claimId)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseClaimDecision(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can decide this request.' }, { status: 403, headers: PRIVATE });
    const done = await decideClaim(admin, id, claimId, parsed.value, { orgId: read.row.org_id ?? null, profileId: read.row.profile_id ?? null }, user.id);
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status, headers: PRIVATE });
    return NextResponse.json(done.value, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/claims/id] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
