import type { NextRequest } from 'next/server';
import { structureSeasonsRoutePOST, structureSeasonsRouteDELETE } from '@/lib/orgs/routes/structure-seasons';

// ── /api/leagues/[id]/structure/seasons — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-seasons.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureSeasonsRoutePOST(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureSeasonsRouteDELETE(request, 'league', await params);
}
