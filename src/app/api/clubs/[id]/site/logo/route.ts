import type { NextRequest } from 'next/server';
import { siteLogoRoutePOST, siteLogoRouteDELETE } from '@/lib/orgs/routes/site-logo';

// ── /api/clubs/[id]/site/logo — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-logo.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteLogoRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteLogoRouteDELETE(request, 'club', await params);
}
