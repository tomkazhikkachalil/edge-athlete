import type { NextRequest } from 'next/server';
import { teamLogoRoutePOST, teamLogoRouteDELETE } from '@/lib/orgs/routes/team-logo';

// ── /api/leagues/[id]/teams/[teamId]/logo — a shim (teams & divisions, PR 6) ──
// The body is src/lib/orgs/routes/team-logo.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamLogoRoutePOST(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamLogoRouteDELETE(request, 'league', await params);
}
