import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { EntryAddSchema } from '@/lib/competitions/validate';
import { entryAddPOST, entryDELETE, requireCompetitionManager } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions/entries — manager entry CRUD (phase 2) ───
// Thin wrapper; the competition-ownership pin (scoped: a foreign org's
// competition answers 404) and the entrant rules live in
// orgs/competition-server.ts.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, EntryAddSchema);
    if (!parsed.success) return parsed.response;
    return await entryAddPOST(admin, parsed.data, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club entries POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — scoped through the competition join (no org column). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    if (!UUID_RE.test(id) || !entryId || !UUID_RE.test(entryId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    return await entryDELETE(admin, entryId, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club entries DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
