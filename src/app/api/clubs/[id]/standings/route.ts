import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/standings — the PUBLIC standings read (R3 spike) ──────
// The #303 recipe: viewer-independent (only visibility='public'
// competitions, zero session branching), so it is CDN-cacheable per org
// with NO Vary:Cookie — one cached entry serves everyone, authed or not.
// Deliberately NO auth call at all: the org page is public and this
// payload is the public subset by construction.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const payload = await fetchPublicStandings(getSupabaseAdmin(), 'club', id);
    if (!payload) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STANDINGS] club GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
