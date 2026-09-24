import type { NextRequest } from 'next/server';
import { siteRouteGET, siteRoutePOST, siteRoutePATCH } from '@/lib/orgs/routes/site';

// ── /api/leagues/[id]/site — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteRoutePOST(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteRoutePATCH(request, 'league', await params);
}
