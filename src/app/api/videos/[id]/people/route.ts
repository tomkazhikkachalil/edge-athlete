import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { tagCandidates } from '@/lib/videos/tag-people-server';
import { readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/**
 * Who the tag form offers before anything is typed (game film round 2, Nov
 * 13 2026): a club's or league's own rosters (the game's linked teams
 * first), or a person's connections. Read ONCE when the form opens — never
 * per keystroke. Only a manager of the video reads it: the list names an
 * organization's private players to the people who entered them.
 *
 * GET → {people: [{id, name, handle, avatar_url, group}], owner_kind}.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'people-search' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can tag this video.' }, { status: 403, headers: PRIVATE });
    const people = await tagCandidates(admin, { id, org_id: read.row.org_id ?? null, profile_id: read.row.profile_id ?? null }, user.id);
    return NextResponse.json({ people, owner_kind: read.row.org_id ? 'org' : 'profile' }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/people] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
