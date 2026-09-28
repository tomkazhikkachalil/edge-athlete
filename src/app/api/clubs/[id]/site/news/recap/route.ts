import type { NextRequest } from 'next/server';
import { siteNewsRecapRouteGET, siteNewsRecapRoutePOST } from '@/lib/orgs/routes/site-news-recap';

// ── /api/clubs/[id]/site/news/recap — a shim (R1, one-click recap drafts) ──
// The body is src/lib/orgs/routes/site-news-recap.ts, one handler for both
// kinds; the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteNewsRecapRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteNewsRecapRoutePOST(request, 'club', await params);
}
