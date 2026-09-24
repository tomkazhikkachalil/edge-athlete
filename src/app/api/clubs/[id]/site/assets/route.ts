import type { NextRequest } from 'next/server';
import { siteAssetsRoutePOST, siteAssetsRouteDELETE } from '@/lib/orgs/routes/site-assets';

// ── /api/clubs/[id]/site/assets — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-assets.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteAssetsRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteAssetsRouteDELETE(request, 'club', await params);
}
