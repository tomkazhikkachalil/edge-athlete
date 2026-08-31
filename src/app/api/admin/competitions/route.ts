import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { CompetitionCreateSchema, CompetitionPatchSchema } from '@/lib/competitions/validate';
import {
  competitionCreatePOST,
  competitionDELETE,
  competitionPATCH,
  competitionsAggregateGET,
} from '@/lib/orgs/competition-server';
import { isSportEnabled } from '@/lib/features';
import type { SportKey } from '@/lib/sports/SportRegistry';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/competitions — thin wrappers over competition-server ─────────
// (Sport gate stays in the route — the 113 convention; validate.ts is
// registry-free. DELETE is admin-only by design: archive is the manager
// affordance, the teams recipe.)

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const side = searchParams.get('side');
    const orgId = searchParams.get('orgId');
    if ((side !== 'league' && side !== 'club') || !orgId || !UUID_RE.test(orgId)) {
      return NextResponse.json({ error: 'side and orgId are required' }, { status: 400 });
    }
    return await competitionsAggregateGET(getSupabaseAdmin(), { side, orgId });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, CompetitionCreateSchema);
    if (!parsed.success) return parsed.response;
    const { side, orgId, sportKey } = parsed.data;
    if (!isSportEnabled(sportKey as SportKey)) {
      return NextResponse.json({ error: `Unknown or disabled sport: ${sportKey}` }, { status: 400 });
    }
    return await competitionCreatePOST(getSupabaseAdmin(), { side, orgId }, parsed.data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, CompetitionPatchSchema);
    if (!parsed.success) return parsed.response;
    return await competitionPATCH(getSupabaseAdmin(), parsed.data, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    return await competitionDELETE(getSupabaseAdmin(), id, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
