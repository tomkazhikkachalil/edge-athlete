// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/competitions/[competitionId]/stat-lines ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
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
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/competitions/[competitionId]/stat-lines (phase 4 R1) ──
// Per-athlete stats on a fixture contest. The gate proves the caller
// manages THIS org; the lib resolves whether that makes them the
// competition owner ('league_verified') or nothing at all — a league is
// never a participant (only clubs enter foreign competitions).

async function gateAndParams(
  request: NextRequest,
  kind: OrgKind, params: { id: string; competitionId: string }
) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
  if (limited) return { limited };
  const { id, competitionId } = params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { limited: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const gate = await requireCompetitionManager(admin, user, kind, id, { competitionId });
  if (!gate.ok) return { limited: gate.response };
  return { user, admin, id, competitionId };
}

export async function competitionsOneStatLinesRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const ctx = await gateAndParams(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    return await statLinesAggregateGET(ctx.admin, ctx.competitionId, {
      side: kind,
      orgId: ctx.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[STAT LINES] ${kind} GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function competitionsOneStatLinesRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const ctx = await gateAndParams(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    const parsed = await parseBody(request, StatLinesUpsertSchema);
    if (!parsed.success) return parsed.response;
    return await statLinesUpsertPOST(
      ctx.admin,
      parsed.data,
      { side: kind, orgId: ctx.id },
      ctx.user.id
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[STAT LINES] ${kind} POST error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function competitionsOneStatLinesRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string; competitionId: string }) {
  try {
    const ctx = await gateAndParams(request, kind, params);
    if ('limited' in ctx) return ctx.limited;
    const lineId = new URL(request.url).searchParams.get('lineId');
    if (!lineId || !UUID_RE.test(lineId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await statLineDELETE(ctx.admin, lineId, { side: kind, orgId: ctx.id }, ctx.user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[STAT LINES] ${kind} DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
