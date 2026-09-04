import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { staffInvitePOST, staffListGET } from '@/lib/orgs/staff-routes';

// ── /api/clubs/[id]/staff — the org's staff + invites (org staff program) ──
// Thin club twin; the gate is called HERE (the route-authz audit), the
// handlers live in orgs/staff-routes.ts.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await staffListGET(request, user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await staffInvitePOST(request, user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
