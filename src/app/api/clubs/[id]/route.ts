import type { NextRequest } from 'next/server';
import { orgRouteGET, orgRoutePATCH } from '@/lib/orgs/routes/org';

// ── /api/clubs/[id] — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/org.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return orgRouteGET(request, 'club', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return orgRoutePATCH(request, 'club', await params);
}
