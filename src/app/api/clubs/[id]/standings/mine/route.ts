import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { standingsMineGET } from '@/lib/orgs/mine-server';

// ── /api/clubs/[id]/standings/mine — the MEMBERS' standings read (phase 9 V4/V5) ─────
// A private club's public standings are the public-only state; members read the
// full payload here (session-gated, private cache). The gate is called HERE
// (the route-authz audit); the read lives in orgs/mine-server.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await standingsMineGET(user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUBS STANDINGS MINE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
