import type { NextRequest } from 'next/server';
import { competitionsOneStatLinesRouteGET, competitionsOneStatLinesRoutePOST, competitionsOneStatLinesRouteDELETE } from '@/lib/orgs/routes/competitions-one-stat-lines';

// ── /api/clubs/[id]/competitions/[competitionId]/stat-lines — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-stat-lines.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneStatLinesRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneStatLinesRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneStatLinesRouteDELETE(request, 'club', await params);
}
