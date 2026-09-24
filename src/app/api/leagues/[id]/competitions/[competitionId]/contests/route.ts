import type { NextRequest } from 'next/server';
import { competitionsOneContestsRoutePOST, competitionsOneContestsRoutePATCH, competitionsOneContestsRouteDELETE } from '@/lib/orgs/routes/competitions-one-contests';

// ── /api/leagues/[id]/competitions/[competitionId]/contests — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-contests.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneContestsRoutePOST(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneContestsRoutePATCH(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneContestsRouteDELETE(request, 'league', await params);
}
