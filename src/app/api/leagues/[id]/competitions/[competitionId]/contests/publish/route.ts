import type { NextRequest } from 'next/server';
import { competitionsOneContestsPublishRoutePOST } from '@/lib/orgs/routes/competitions-one-contests-publish';

// ── /api/leagues/[id]/competitions/[competitionId]/contests/publish — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-contests-publish.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneContestsPublishRoutePOST(request, 'league', await params);
}
