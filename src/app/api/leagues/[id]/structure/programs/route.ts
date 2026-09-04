import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ProgramCreateSchema } from '@/lib/registration/validate';
import { programCreatePOST, programDELETE, requireOrgManager } from '@/lib/orgs/structure-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/structure/programs — manager program CRUD (phase 5) ───
// Thin wrapper; the seasons-route pattern. Programs are divisions'
// non-competitive siblings (camps, clinics); org derives via the season.

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
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_structure' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ProgramCreateSchema);
    if (!parsed.success) return parsed.response;
    if (!isSportEnabled(parsed.data.sportKey as SportKey)) {
      return NextResponse.json({ error: 'That sport isn’t enabled' }, { status: 400 });
    }
    return await programCreatePOST(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STRUCTURE] league programs POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, 'league', id, { intent: 'manage_structure' });
    if (!gate.ok) return gate.response;

    const programId = new URL(request.url).searchParams.get('id');
    if (!programId || !UUID_RE.test(programId)) {
      return NextResponse.json({ error: 'Program not found' }, { status: 404 });
    }
    return await programDELETE(admin, programId, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STRUCTURE] league programs DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
