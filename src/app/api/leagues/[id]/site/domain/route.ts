import type { NextRequest } from 'next/server';
import { siteDomainRouteGET, siteDomainRoutePOST, siteDomainRouteDELETE } from '@/lib/orgs/routes/site-domain';

// ── /api/leagues/[id]/site/domain — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-domain.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteDomainRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteDomainRoutePOST(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteDomainRouteDELETE(request, 'league', await params);
}
