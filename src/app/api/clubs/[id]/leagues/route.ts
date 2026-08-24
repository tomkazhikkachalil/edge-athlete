import { NextRequest, NextResponse } from 'next/server';
import { affiliationGET, affiliationPOST, affiliationAccept, affiliationDELETE } from '@/lib/affiliations/server';
import { parseBody } from '@/lib/validation';
import { AffiliationLeagueTargetSchema, AffiliationAcceptLeagueSchema } from '@/lib/affiliations/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/leagues — the club side of affiliations (118) ───────────
// Thin wrapper: ALL logic, including the AUTHORIZATION MATRIX, lives in
// src/lib/affiliations/server.ts (one place, both routes).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await affiliationGET(request, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB LEAGUES] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await parseBody(request, AffiliationLeagueTargetSchema);
    if (!parsed.success) return parsed.response;
    return await affiliationPOST(request, 'club', id, parsed.data.leagueId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB LEAGUES] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await parseBody(request, AffiliationAcceptLeagueSchema);
    if (!parsed.success) return parsed.response;
    return await affiliationAccept(request, 'club', id, parsed.data.leagueId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB LEAGUES] PATCH error:', error);
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
    const leagueId = searchParams.get('leagueId');
    if (!leagueId || !UUID_RE.test(leagueId)) {
      return NextResponse.json({ error: 'leagueId is required' }, { status: 400 });
    }
    return await affiliationDELETE(request, 'club', id, leagueId);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB LEAGUES] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
