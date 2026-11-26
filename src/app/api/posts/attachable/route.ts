import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { resolveProfileAction } from '@/lib/profile-roles';
import { isUuid } from '@/lib/uuid';
import { listAttachable } from '@/lib/posts/attachment-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/posts/attachable[?profileId=] — the composer's Attach activity
 * picker (General post spec, Nov 26 2026; migration 321): the author's recent
 * logged activities that may be attached to a post — finished golf rounds,
 * finished workouts, tracked activities and game stat lines, never one hidden
 * from the profile or marked Only me — each as its stat plate, newest first.
 * Own by default; a write_content guardian may read an athlete's (they post
 * as the athlete). Private, never cached — it is the owner's list.
 * Response: { activities: StatPlateData[] }.
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
    const activities = await listAttachable(getSupabaseAdmin(), profileId);
    return NextResponse.json({ activities }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    reportRouteError('posts/attachable: read failed:', e);
    return NextResponse.json({ error: 'Could not load your activities' }, { status: 500 });
  }
}
