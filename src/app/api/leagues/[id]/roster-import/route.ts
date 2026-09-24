import type { NextRequest } from 'next/server';
import { rosterImportRoutePOST } from '@/lib/orgs/routes/roster-import';

// ── /api/leagues/[id]/roster-import — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/roster-import.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return rosterImportRoutePOST(request, 'league', await params);
}
