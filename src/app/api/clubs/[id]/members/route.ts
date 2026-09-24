import type { NextRequest } from 'next/server';
import { membersRoutePOST, membersRoutePATCH, membersRouteDELETE } from '@/lib/orgs/routes/members';

// ── /api/clubs/[id]/members — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/members.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return membersRoutePOST(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return membersRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return membersRouteDELETE(request, 'club', await params);
}
