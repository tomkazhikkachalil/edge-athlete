import type { NextRequest } from 'next/server';
import { competitionsRouteGET, competitionsRoutePOST, competitionsRoutePATCH } from '@/lib/orgs/routes/competitions';

// ── /api/leagues/[id]/competitions — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsRoutePOST(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsRoutePATCH(request, 'league', await params);
}
