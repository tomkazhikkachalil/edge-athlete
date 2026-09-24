import type { NextRequest } from 'next/server';
import { structureEntriesRoutePOST, structureEntriesRouteDELETE } from '@/lib/orgs/routes/structure-entries';

// ── /api/clubs/[id]/structure/entries — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-entries.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureEntriesRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureEntriesRouteDELETE(request, 'club', await params);
}
