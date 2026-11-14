import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { parsePlaceholderName, PLACEHOLDER_REFUSALS } from '@/lib/videos/tag-people';
import { addPlaceholderPlayer, tagCandidates } from '@/lib/videos/tag-people-server';
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
 *
 * POST {name, side?} → 201 {person}: a player WITHOUT an account, on a club's
 * or league's own video only. It is a roster stub (private, claimable), so
 * the caller must manage the video AND the organization's roster.
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'tag-placeholder' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const raw = (body && typeof body === 'object' ? body : {}) as { name?: unknown; side?: unknown };
    const name = parsePlaceholderName(raw.name);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400, headers: PRIVATE });
    if (raw.side !== undefined && raw.side !== null && raw.side !== 1 && raw.side !== 2) return NextResponse.json({ error: 'side must be 1 or 2' }, { status: 400, headers: PRIVATE });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can tag this video.' }, { status: 403, headers: PRIVATE });
    const owner = read.view.owner;
    if (owner.kind !== 'org') return NextResponse.json({ error: PLACEHOLDER_REFUSALS.not_org }, { status: 403, headers: PRIVATE });
    const gate = await requireOrgManager(admin, user, owner.side, owner.id, { intent: 'manage_members' });
    if (!gate.ok) return NextResponse.json({ error: PLACEHOLDER_REFUSALS.no_roster_right }, { status: 403, headers: PRIVATE });
    const made = await addPlaceholderPlayer(admin, {
      videoId: id,
      org: { id: owner.id, side: owner.side, name: gate.org.name },
      firstName: name.firstName,
      lastName: name.lastName,
      side: raw.side === 1 || raw.side === 2 ? raw.side : null,
      createdBy: user.id,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app',
    });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500, headers: PRIVATE });
    return NextResponse.json({ person: made.person }, { status: 201, headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/people] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
