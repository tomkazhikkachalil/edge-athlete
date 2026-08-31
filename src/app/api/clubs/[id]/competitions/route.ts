import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { CompetitionCreateSchema, CompetitionPatchSchema } from '@/lib/competitions/validate';
import {
  competitionCreatePOST,
  competitionPATCH,
  competitionsAggregateGET,
  requireCompetitionManager,
} from '@/lib/orgs/competition-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions — manager competition CRUD (phase 2) ─────
// Thin wrapper; gate + rules in orgs/competition-server.ts. The body/URL
// mismatch guard runs BEFORE the lib call. No DELETE — archive is the
// manager affordance (the teams recipe); hard delete stays admin.

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
    const admin = getSupabaseAdmin();
    const gate = await requireCompetitionManager(admin, user, 'club', id);
    if (!gate.ok) return gate.response;
    return await competitionsAggregateGET(admin, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    const parsed = await parseBody(request, CompetitionCreateSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.side !== 'club' || parsed.data.orgId !== id) {
      return NextResponse.json({ error: 'Body organization does not match the URL' }, { status: 400 });
    }
    if (!isSportEnabled(parsed.data.sportKey as SportKey)) {
      return NextResponse.json(
        { error: `Unknown or disabled sport: ${parsed.data.sportKey}` },
        { status: 400 }
      );
    }
    return await competitionCreatePOST(admin, { side: 'club', orgId: id }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    const parsed = await parseBody(request, CompetitionPatchSchema);
    if (!parsed.success) return parsed.response;
    return await competitionPATCH(admin, parsed.data, { side: 'club', orgId: id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[COMPETITIONS] club PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
