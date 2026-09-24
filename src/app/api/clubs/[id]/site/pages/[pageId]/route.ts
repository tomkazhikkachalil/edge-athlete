import type { NextRequest } from 'next/server';
import { sitePagesItemRouteGET, sitePagesItemRoutePATCH, sitePagesItemRouteDELETE } from '@/lib/orgs/routes/site-pages-item';

// ── /api/clubs/[id]/site/pages/[pageId] — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-pages-item.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  return sitePagesItemRouteGET(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  return sitePagesItemRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; pageId: string }> }) {
  return sitePagesItemRouteDELETE(request, 'club', await params);
}
