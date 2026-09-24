import type { NextRequest } from 'next/server';
import { competitionsOneStatLinesImportRoutePOST } from '@/lib/orgs/routes/competitions-one-stat-lines-import';

// ── /api/leagues/[id]/competitions/[competitionId]/stat-lines-import — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-stat-lines-import.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneStatLinesImportRoutePOST(request, 'league', await params);
}
