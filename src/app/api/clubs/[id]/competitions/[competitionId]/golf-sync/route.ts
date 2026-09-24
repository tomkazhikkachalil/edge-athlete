import type { NextRequest } from 'next/server';
import { competitionsOneGolfSyncRoutePOST } from '@/lib/orgs/routes/competitions-one-golf-sync';

// ── /api/clubs/[id]/competitions/[competitionId]/golf-sync — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-golf-sync.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneGolfSyncRoutePOST(request, 'club', await params);
}
