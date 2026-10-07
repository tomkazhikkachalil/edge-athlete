import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { resolveProfileAction } from '@/lib/profile-roles';
import { isUuid } from '@/lib/uuid';
import { readDrafts } from '@/lib/drafts/server';
import { draftsCount } from '@/lib/drafts/list';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/drafts[?profileId=] — what the viewer has started or finished but
 * not posted (Drafts round, Oct 2026): rounds in progress, drafts, workouts
 * in progress. Own by default; a write_content guardian may read an
 * athlete's. Private, never cached — it is the owner's list.
 * Response: { inProgress, drafts, count }.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const requested = new URL(request.url).searchParams.get('profileId');
    let profileId = user.id;
    if (requested && requested !== user.id) {
      if (!isUuid(requested)) return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
      if (!resolveProfileAction(await getProfileRole(user.id, requested), 'write_content')) {
        return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
      }
      profileId = requested;
    }
    const list = await readDrafts(getSupabaseAdmin(), profileId);
    return NextResponse.json(
      { ...list, count: draftsCount(list) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    reportRouteError('drafts: read failed:', e);
    return NextResponse.json({ error: 'Could not load your drafts' }, { status: 500 });
  }
}
