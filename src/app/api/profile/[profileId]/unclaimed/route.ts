import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseListed } from '@/lib/sport-profile/unclaimed';
import { readUnclaimed, setUnclaimedListed } from '@/lib/sport-profile/unclaimed-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Profile not found' }, { status: 404, headers: PRIVATE });

/**
 * GET /api/profile/[profileId]/unclaimed — the unclaimed page's own facts
 * (migration 312; docs/specs/sport-profile.md, "Unclaimed"): the short name,
 * the sports with film, the organization that tagged it, the viewer's own
 * request, and — for that organization's video managers — the open requests
 * and whether the page is open. Signed-in only. 404 for anything that is
 * not a placeholder, or a placeholder kept private from this viewer.
 *
 * PATCH {listed} — the organization's switch: keep the page private, or
 * open it again. Its video managers only (a 404 for anyone else).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NOT_FOUND();
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const view = await readUnclaimed(getSupabaseAdmin(), profileId, user.id);
    if (!view) return NOT_FOUND();
    return NextResponse.json({ unclaimed: view }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/unclaimed] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const { profileId } = await params;
    if (!isUuid(profileId)) return NOT_FOUND();
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'settings-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = parseListed(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: PRIVATE });
    const saved = await setUnclaimedListed(getSupabaseAdmin(), profileId, parsed.listed, user.id);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status, headers: PRIVATE });
    return NextResponse.json(saved.value, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/profile/unclaimed] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
