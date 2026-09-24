import type { NextRequest } from 'next/server';
import { structureImportRoutePOST } from '@/lib/orgs/routes/structure-import';

// ── /api/clubs/[id]/structure-import — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-import.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureImportRoutePOST(request, 'club', await params);
}
