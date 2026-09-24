import type { NextRequest } from 'next/server';
import { competitionsEntriesRoutePOST, competitionsEntriesRoutePATCH, competitionsEntriesRouteDELETE } from '@/lib/orgs/routes/competitions-entries';

// ── /api/clubs/[id]/competitions/entries — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-entries.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsEntriesRoutePOST(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsEntriesRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return competitionsEntriesRouteDELETE(request, 'club', await params);
}
