import type { NextRequest } from 'next/server';
import { structureTeamsRoutePOST, structureTeamsRoutePATCH } from '@/lib/orgs/routes/structure-teams';

// ── /api/clubs/[id]/structure/teams — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-teams.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureTeamsRoutePOST(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureTeamsRoutePATCH(request, 'club', await params);
}
