import type { NextRequest } from 'next/server';
import { structureDivisionsRoutePOST, structureDivisionsRouteDELETE } from '@/lib/orgs/routes/structure-divisions';

// ── /api/clubs/[id]/structure/divisions — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-divisions.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureDivisionsRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureDivisionsRouteDELETE(request, 'club', await params);
}
