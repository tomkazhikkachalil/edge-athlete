import type { NextRequest } from 'next/server';
import { siteNewsItemRouteGET, siteNewsItemRoutePATCH, siteNewsItemRouteDELETE } from '@/lib/orgs/routes/site-news-item';

// ── /api/leagues/[id]/site/news/[newsId] — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-news-item.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; newsId: string }> }) {
  return siteNewsItemRouteGET(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; newsId: string }> }) {
  return siteNewsItemRoutePATCH(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; newsId: string }> }) {
  return siteNewsItemRouteDELETE(request, 'league', await params);
}
