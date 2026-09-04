import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { staffRowDELETE, staffRowPATCH } from '@/lib/orgs/staff-routes';

// ── /api/clubs/[id]/staff/[rowId] — change / revoke one grant (club twin) ──
// The gate is called HERE (the route-authz audit).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const user = await requireAuth(request);
    return await staffRowPATCH(request, user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  try {
    const user = await requireAuth(request);
    return await staffRowDELETE(request, user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
