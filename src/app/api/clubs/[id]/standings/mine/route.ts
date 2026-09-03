import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import { getOrgAndRole } from '@/lib/orgs/authz';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/standings/mine — the MEMBERS' standings read (V4) ─────
// A private club's public standings are the empty state (the CDN-cached
// read must stay viewer-independent). Members read the full payload
// HERE: a separate path (never a ?scope= on the cached URL), session-
// gated, Cache-Control private / no-store — the golf/mine precedent.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const loaded = await getOrgAndRole(admin, 'club', id, user.id);
    if (loaded.status !== 'found') return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    if (!loaded.role && loaded.org.owner_profile_id !== user.id) {
      return NextResponse.json({ error: 'Members only' }, { status: 403 });
    }
    const payload = await fetchPublicStandings(admin, 'club', id, { membersView: true });
    if (!payload) return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STANDINGS] club mine GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
