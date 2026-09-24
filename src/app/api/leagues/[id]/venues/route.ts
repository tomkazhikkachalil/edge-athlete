import type { NextRequest } from 'next/server';
import { venuesRouteGET, venuesRoutePOST } from '@/lib/orgs/routes/venues';

// ── /api/leagues/[id]/venues — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/venues.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return venuesRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return venuesRoutePOST(request, 'league', await params);
}
