import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { newsMineGET } from '@/lib/orgs/mine-server';

// ── /api/leagues/[id]/news/mine — the MEMBERS' news read (program 11 L2) ─────
// A private league's public news is the public-only state; members read the
// full payload here (session-gated, private cache). The gate is called HERE
// (the route-authz audit); the read lives in orgs/mine-server.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await newsMineGET(user, 'league', params);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUES NEWS MINE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
