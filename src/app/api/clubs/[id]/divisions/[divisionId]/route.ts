import type { NextRequest } from 'next/server';
import { divisionRouteGET } from '@/lib/orgs/routes/teams';

// ── /api/clubs/[id]/divisions/[divisionId] — a shim (teams & divisions, PR 9) ──
// The body is src/lib/orgs/routes/teams.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; divisionId: string }> }) {
  return divisionRouteGET(request, 'club', await params);
}
