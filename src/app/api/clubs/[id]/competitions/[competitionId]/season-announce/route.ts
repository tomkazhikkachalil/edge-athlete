import type { NextRequest } from 'next/server';
import { competitionsOneSeasonAnnounceRouteGET, competitionsOneSeasonAnnounceRoutePOST } from '@/lib/orgs/routes/competitions-one-season-announce';

// ── /api/clubs/[id]/competitions/[competitionId]/season-announce — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-season-announce.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneSeasonAnnounceRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneSeasonAnnounceRoutePOST(request, 'club', await params);
}
