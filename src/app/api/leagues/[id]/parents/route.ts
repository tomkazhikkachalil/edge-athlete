import { NextRequest, NextResponse } from 'next/server';
import {
  parentsGET,
  parentPOST,
  parentAccept,
  parentDELETE,
} from '@/lib/affiliations/parents-server';
import { AffiliationTypeSchema, type AffiliationType } from '@/lib/affiliations/validate';

// ── /api/leagues/[id]/parents (phase 6 R3, mig 167) ─────────────────────────
// League↔league affiliations — [id] is the league whose console the
// caller drives; the other league rides body/query. direction 'up' =
// request a parent (default), 'down' = invite a child. The 118 matrix
// lives in parents-server.ts; affiliation grants NOTHING.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await parentsGET(request, id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PARENTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      leagueId?: unknown;
      affiliationType?: unknown;
      direction?: unknown;
    };
    const other = typeof body.leagueId === 'string' ? body.leagueId : '';
    const parsedType = AffiliationTypeSchema.safeParse(body.affiliationType);
    const affType: AffiliationType = parsedType.success ? parsedType.data : 'member_of';
    const direction = body.direction === 'down' ? 'down' : 'up';
    return await parentPOST(request, id, other, affType, direction);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PARENTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { leagueId?: unknown };
    const other = typeof body.leagueId === 'string' ? body.leagueId : '';
    return await parentAccept(request, id, other);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PARENTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const other = new URL(request.url).searchParams.get('leagueId') ?? '';
    return await parentDELETE(request, id, other);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[PARENTS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
