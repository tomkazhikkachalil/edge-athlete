import type { NextRequest } from 'next/server';
import { competitionsOneMediaTagsRoutePOST, competitionsOneMediaTagsRouteDELETE } from '@/lib/orgs/routes/competitions-one-media-tags';

// ── /api/leagues/[id]/competitions/[competitionId]/media/tags — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-media-tags.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaTagsRoutePOST(request, 'league', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneMediaTagsRouteDELETE(request, 'league', await params);
}
