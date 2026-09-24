import type { NextRequest } from 'next/server';
import { sitePagesRouteGET, sitePagesRoutePOST } from '@/lib/orgs/routes/site-pages';

// ── /api/leagues/[id]/site/pages — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-pages.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return sitePagesRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return sitePagesRoutePOST(request, 'league', await params);
}
