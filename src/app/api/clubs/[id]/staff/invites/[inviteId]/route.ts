import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { staffInviteDELETE } from '@/lib/orgs/staff-routes';

// ── /api/clubs/[id]/staff/invites/[inviteId] — revoke an open invite (club twin) ──
// The gate is called HERE (the route-authz audit).

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; inviteId: string }> }) {
  try {
    const user = await requireAuth(request);
    return await staffInviteDELETE(request, user, 'club', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
