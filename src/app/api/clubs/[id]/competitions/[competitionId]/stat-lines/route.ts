import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { StatLinesUpsertSchema } from '@/lib/competitions/validate';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import {
  statLineDELETE,
  statLinesAggregateGET,
  statLinesUpsertPOST,
} from '@/lib/orgs/stat-lines-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/competitions/[competitionId]/stat-lines (phase 4 R1) ──
// Per-athlete stats on a fixture contest. The gate proves the caller
// manages THIS club; the lib resolves whether that makes them the
// competition owner ('league_verified') or a PARTICIPANT — a club with an
// approved team entry in a competition it doesn't own enters stats for
// its OWN players only, stamped 'club_recorded' (Tom's R1 call).

async function gateAndParams(
  request: NextRequest,
  params: Promise<{ id: string; competitionId: string }>
) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
  if (limited) return { limited };
  const { id, competitionId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { limited: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const gate = await requireCompetitionManager(admin, user, 'club', id);
  if (!gate.ok) return { limited: gate.response };
  return { user, admin, id, competitionId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    return await statLinesAggregateGET(ctx.admin, ctx.competitionId, {
      side: 'club',
      orgId: ctx.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STAT LINES] club GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const parsed = await parseBody(request, StatLinesUpsertSchema);
    if (!parsed.success) return parsed.response;
    return await statLinesUpsertPOST(
      ctx.admin,
      parsed.data,
      { side: 'club', orgId: ctx.id },
      ctx.user.id
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STAT LINES] club POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const lineId = new URL(request.url).searchParams.get('lineId');
    if (!lineId || !UUID_RE.test(lineId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await statLineDELETE(ctx.admin, lineId, { side: 'club', orgId: ctx.id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[STAT LINES] club DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
