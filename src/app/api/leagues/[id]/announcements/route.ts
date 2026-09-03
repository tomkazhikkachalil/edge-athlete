import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { getOrgAndRole } from '@/lib/orgs/authz';
import { orgAnnouncementsGET } from '@/lib/orgs/announce-archive-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/announcements — the MEMBERS' archive (N3, program 10)
// Every announcement the org ever sent (the notification rows grouped
// by announcement_id), for members and the owner; private cache. The
// in-app org page and the console history read it.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const loaded = await getOrgAndRole(admin, 'league', id, user.id);
    if (loaded.status !== 'found') return NextResponse.json({ error: 'League not found' }, { status: 404 });
    if (!loaded.role && loaded.org.owner_profile_id !== user.id) {
      return NextResponse.json({ error: 'Members only' }, { status: 403 });
    }
    return await orgAnnouncementsGET(admin, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ANNOUNCE] league archive GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
