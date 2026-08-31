import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { structureOptionsGET } from '@/lib/orgs/structure-options';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/structure-options — the event form's sub-org picker ─────
// Mirror of the league route; the gate + payload live in
// orgs/structure-options.ts.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    return await structureOptionsGET(getSupabaseAdmin(), user, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STRUCTURE OPTIONS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
