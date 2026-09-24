import type { NextRequest } from 'next/server';
import { competitionsQuickstartRoutePOST } from '@/lib/orgs/routes/competitions-quickstart';

// ── /api/leagues/[id]/competitions/quickstart — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-quickstart.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsQuickstartRoutePOST(request, 'league', await params);
}
