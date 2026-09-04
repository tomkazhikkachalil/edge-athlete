import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { DivisionCreateSchema } from '@/lib/structure/validate';
import { requireOrgManager, divisionCreatePOST, divisionDELETE } from '@/lib/orgs/structure-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/structure/divisions — manager division CRUD ──────────
// The scope pins the season lookup: a foreign org's season answers 404.

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
      return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, { intent: 'manage_structure' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, DivisionCreateSchema);
    if (!parsed.success) return parsed.response;
    if (!isSportEnabled(parsed.data.sportKey as SportKey)) {
      return NextResponse.json(
        { error: `Unknown or disabled sport: ${parsed.data.sportKey}` },
        { status: 400 }
      );
    }
    return await divisionCreatePOST(admin, parsed.data, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] divisions POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — scoped; entries CASCADE, teams persist. */
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
    const divisionId = searchParams.get('id');
    if (!UUID_RE.test(id) || !divisionId || !UUID_RE.test(divisionId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'club', id, {
      intent: 'manage_structure',
      scope: { type: 'division', id: divisionId },
    });
    if (!gate.ok) return gate.response;
    return await divisionDELETE(admin, divisionId, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG STRUCTURE] divisions DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
