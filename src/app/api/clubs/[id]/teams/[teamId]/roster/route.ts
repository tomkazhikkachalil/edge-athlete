import type { NextRequest } from 'next/server';
import { teamRosterRouteGET, teamRosterRoutePOST, teamRosterRoutePATCH, teamRosterRouteDELETE } from '@/lib/orgs/routes/team-roster';

// ── /api/clubs/[id]/teams/[teamId]/roster — a shim (teams & divisions, PR 4) ──
// The body is src/lib/orgs/routes/team-roster.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamRosterRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamRosterRoutePOST(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamRosterRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  return teamRosterRouteDELETE(request, 'club', await params);
}
