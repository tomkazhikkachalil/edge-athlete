import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { EntryCreateSchema } from '@/lib/structure/validate';
import { requireOrgManager, entryCreatePOST, entryDELETE } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/structure/entries — manager placements (phase 1) ─────
// Scoped: foreign teams/divisions answer 404; the cross-org and
// archived-team rules live in the shared lib.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, EntryCreateSchema);
    if (!parsed.success) return parsed.response;
    return await entryCreatePOST(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] entries POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — withdraw an entry (verified through the division join). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    if (!UUID_RE.test(id) || !entryId || !UUID_RE.test(entryId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id);
    if (!gate.ok) return gate.response;
    return await entryDELETE(admin, entryId, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] entries DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
