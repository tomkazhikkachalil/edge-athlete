import { NextRequest, NextResponse } from 'next/server';
import { affiliationGET, affiliationPOST, affiliationAccept, affiliationDELETE } from '@/lib/affiliations/server';
import { parseBody } from '@/lib/validation';
import { AffiliationClubTargetSchema, AffiliationAcceptClubSchema } from '@/lib/affiliations/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/clubs — the league side of affiliations (118) ─────────
// Thin wrapper: ALL logic, including the AUTHORIZATION MATRIX, lives in
// src/lib/affiliations/server.ts (one place, both routes).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await affiliationGET(request, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE CLUBS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await parseBody(request, AffiliationClubTargetSchema);
    if (!parsed.success) return parsed.response;
    return await affiliationPOST(request, 'league', id, parsed.data.clubId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE CLUBS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await parseBody(request, AffiliationAcceptClubSchema);
    if (!parsed.success) return parsed.response;
    return await affiliationAccept(request, 'league', id, parsed.data.clubId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE CLUBS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const clubId = searchParams.get('clubId');
    if (!clubId || !UUID_RE.test(clubId)) {
      return NextResponse.json({ error: 'clubId is required' }, { status: 400 });
    }
    return await affiliationDELETE(request, 'league', id, clubId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE CLUBS] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
