import type { NextRequest } from 'next/server';
import { structureProgramsRoutePOST, structureProgramsRouteDELETE } from '@/lib/orgs/routes/structure-programs';

// ── /api/clubs/[id]/structure/programs — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/structure-programs.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureProgramsRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return structureProgramsRouteDELETE(request, 'club', await params);
}
