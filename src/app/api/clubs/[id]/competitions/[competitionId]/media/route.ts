import type { NextRequest } from 'next/server';
import { competitionsOneMediaRouteGET, competitionsOneMediaRoutePOST, competitionsOneMediaRoutePATCH, competitionsOneMediaRouteDELETE } from '@/lib/orgs/routes/competitions-one-media';

// ── /api/clubs/[id]/competitions/[competitionId]/media — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-media.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaRoutePOST(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaRouteDELETE(request, 'club', await params);
}
