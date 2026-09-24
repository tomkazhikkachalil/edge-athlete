import type { NextRequest } from 'next/server';
import { ownersRoutePOST, ownersRouteDELETE } from '@/lib/orgs/routes/owners';

// ── /api/clubs/[id]/owners — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/owners.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return ownersRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return ownersRouteDELETE(request, 'club', await params);
}
