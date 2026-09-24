import type { NextRequest } from 'next/server';
import { competitionsOneGolfSyncConfirmRoutePOST } from '@/lib/orgs/routes/competitions-one-golf-sync-confirm';

// ── /api/leagues/[id]/competitions/[competitionId]/golf-sync/confirm — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-golf-sync-confirm.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneGolfSyncConfirmRoutePOST(request, 'league', await params);
}
