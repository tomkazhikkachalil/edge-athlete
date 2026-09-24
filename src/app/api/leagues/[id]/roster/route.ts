import type { NextRequest } from 'next/server';
import { rosterRoutePOST, rosterRoutePATCH, rosterRouteDELETE } from '@/lib/orgs/routes/roster';

// ── /api/leagues/[id]/roster — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/roster.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return rosterRoutePOST(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return rosterRoutePATCH(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return rosterRouteDELETE(request, 'league', await params);
}
