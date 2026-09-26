import type { NextRequest } from 'next/server';
import { authorityLogRouteGET } from '@/lib/orgs/routes/authority-log';

// ── /api/clubs/[id]/authority-log — a shim (Authority PR 5) ──
// The body is src/lib/orgs/routes/authority-log.ts, one handler for both kinds;
// the gate lives there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return authorityLogRouteGET(request, 'club', await params);
}
