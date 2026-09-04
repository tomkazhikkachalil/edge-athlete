import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ContestCreateSchema, ContestPatchSchema } from '@/lib/competitions/validate';
import {
  contestCreatePOST,
  contestDELETE,
  contestPATCH,
  requireCompetitionManager,
} from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/contests (phase 2 R2) ────
// Thin wrapper; ownership + fixture rules in orgs/competition-server.ts.
// The body/URL competition mismatch guard runs BEFORE the lib call.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ContestCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.competitionId !== competitionId) {
      return NextResponse.json({ error: 'Body competition does not match the URL' }, { status: 400 });
    }
    return await contestCreatePOST(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league contests POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, ContestPatchSchema);
    if (!parsed.success) return parsed.response;
    return await contestPATCH(admin, parsed.data, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league contests PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE ?id= — scoped through the competition join. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
    if (limited) return limited;
    const { id, competitionId } = await params;
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('id');
    if (!UUID_RE.test(id) || !UUID_RE.test(competitionId) || !contestId || !UUID_RE.test(contestId)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
    if (!gate.ok) return gate.response;
    return await contestDELETE(admin, contestId, { side: 'league', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] league contests DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
