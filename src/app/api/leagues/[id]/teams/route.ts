import type { NextRequest } from 'next/server';
import { teamsListRouteGET } from '@/lib/orgs/routes/teams';

// ── /api/leagues/[id]/teams — a shim (teams & divisions, PR 8) ──
// The body is src/lib/orgs/routes/teams.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return teamsListRouteGET(request, 'league', await params);
}
