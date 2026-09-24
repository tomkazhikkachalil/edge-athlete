import type { NextRequest } from 'next/server';
import { joinRequestsRouteGET, joinRequestsRoutePATCH } from '@/lib/orgs/routes/join-requests';

// ── /api/clubs/[id]/join-requests — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/join-requests.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return joinRequestsRouteGET(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return joinRequestsRoutePATCH(request, 'club', await params);
}
