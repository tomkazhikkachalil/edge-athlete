import type { NextRequest } from 'next/server';
import { siteNewsRouteGET, siteNewsRoutePOST } from '@/lib/orgs/routes/site-news';

// ── /api/leagues/[id]/site/news — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-news.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteNewsRouteGET(request, 'league', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteNewsRoutePOST(request, 'league', await params);
}
