import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseLinkBody } from '@/lib/videos/tag-claims';
import { linkTagTarget, readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/**
 * A manager links a typed name, or a placeholder player, to a profile
 * (round 2 PR 4, Nov 13 2026): every tag under it in the owner's videos
 * becomes that profile's, under the owner's who-may-be-tagged rule. The
 * athlete is told once and keeps the right to remove the tags.
 *
 * POST {target: {name} | {profile_id}, profile_id} → {linked, videos, kept}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
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
    const parsed = parseLinkBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can link people in this video.' }, { status: 403, headers: PRIVATE });
    const done = await linkTagTarget(admin, { orgId: read.row.org_id ?? null, profileId: read.row.profile_id ?? null }, parsed.value.target, parsed.value.profileId, user.id, { checkWho: true });
    if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status, headers: PRIVATE });
    return NextResponse.json(done.value, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/links] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
