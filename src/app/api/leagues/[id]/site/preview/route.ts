import type { NextRequest } from 'next/server';
import { sitePreviewRoutePOST } from '@/lib/orgs/routes/site-preview';

// ── /api/leagues/[id]/site/preview — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-preview.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return sitePreviewRoutePOST(request, 'league', await params);
}
