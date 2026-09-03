import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { photoCandidatesGET } from '@/lib/org-sites/member-photos-routes';

// ── /api/leagues/[id]/site/photo-candidates — the manager's browse list
// (M2, program 10; both sides since program 12): photos on PUBLIC golf round
// posts by members who opted in, with the current picks marked. The gate is
// called HERE (the route-authz audit); the logic lives in
// org-sites/member-photos-routes.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await photoCandidatesGET(user, 'league', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
