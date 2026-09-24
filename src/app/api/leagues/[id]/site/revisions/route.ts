import type { NextRequest } from 'next/server';
import { siteRevisionsRouteGET, siteRevisionsRoutePOST } from '@/lib/orgs/routes/site-revisions';

// ── /api/leagues/[id]/site/revisions — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-revisions.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteRevisionsRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteRevisionsRoutePOST(request, 'league', await params);
}
