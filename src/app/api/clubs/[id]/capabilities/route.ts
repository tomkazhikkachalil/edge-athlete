import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { capabilitiesGET } from '@/lib/orgs/capabilities-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/capabilities — the viewer's console capabilities ────
// Thin club twin; the shape lives in orgs/capabilities-server.ts.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    return await capabilitiesGET(getSupabaseAdmin(), 'club', id, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB CAPABILITIES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
