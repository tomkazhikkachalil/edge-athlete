import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RosterAcceptSchema } from '@/lib/leagues/validate';
import { rosterDelete, rosterPatch, rosterPost } from '@/lib/orgs/roster-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/roster — offers, accepts, declines (0.3) ──────────────
// Thin wrapper; the authorization matrix lives in orgs/roster-server.ts.

/** POST ?profileId= — a manager invites an existing member to the roster. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'roster-offer', { userId: user.id });
    if (limited) return limited;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    return await rosterPost(getSupabaseAdmin(), user, 'league', id, profileId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { action: 'accept' } — the athlete accepts their pending offer. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const parsed = await parseBody(request, RosterAcceptSchema);
    if (!parsed.success) return parsed.response;

    return await rosterPatch(getSupabaseAdmin(), user, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE [?profileId=] — self decline/leave, or manager cancel/remove. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    return await rosterDelete(getSupabaseAdmin(), user, 'league', id, profileId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
