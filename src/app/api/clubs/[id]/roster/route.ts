import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RosterAcceptSchema } from '@/lib/clubs/validate';
import { rosterDelete, rosterPatch, rosterPost } from '@/lib/orgs/roster-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/roster — offers, accepts, declines (0.3) ──────────────
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
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }

    return await rosterPost(getSupabaseAdmin(), user, 'club', id, profileId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { action: 'accept', profileId? } — the athlete accepts their
 *  pending offer; a guardian passes profileId to accept for their
 *  supervised athlete (0.10, requireProfileRole-gated — the followers
 *  route model). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const parsed = await parseBody(request, RosterAcceptSchema);
    if (!parsed.success) return parsed.response;

    let actingFor: string | undefined;
    if (parsed.data.profileId && parsed.data.profileId !== user.id) {
      await requireProfileRole(request, parsed.data.profileId, 'manage_privacy');
      actingFor = parsed.data.profileId;
    }
    return await rosterPatch(getSupabaseAdmin(), user, 'club', id, actingFor);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE [?profileId=[&as=guardian]] — self decline/leave, manager
 *  cancel/remove, or (as=guardian, 0.10) a guardian declining/leaving for
 *  their supervised athlete — requireProfileRole-gated, self-equivalent. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    if (profileId && !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
    }
    let guardianActing = false;
    if (searchParams.get('as') === 'guardian') {
      if (!profileId || profileId === user.id) {
        return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
      }
      await requireProfileRole(request, profileId, 'manage_privacy');
      guardianActing = true;
    }

    return await rosterDelete(getSupabaseAdmin(), user, 'club', id, profileId, guardianActing);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ROSTER] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
