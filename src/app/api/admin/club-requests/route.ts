import { NextRequest, NextResponse } from 'next/server';
import { adminRequestsGET, adminRequestsPATCH } from '@/lib/orgs/admin-requests-server';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/admin/club-requests — the decision queue ────────────────────────
// A shim (Round 5 D3): the body is adminRequestsGET / adminRequestsPATCH in
// src/lib/orgs/admin-requests-server.ts, one handler for both kinds over
// `org_requests` (236) — requireAdmin inside.

/** GET — pending requests, oldest first, with requester. */
export async function GET(request: NextRequest) {
  try {
    return await adminRequestsGET(request, 'club');
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ADMIN CLUB REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { requestId, decision, reason? } — approve or decline. */
export async function PATCH(request: NextRequest) {
  try {
    return await adminRequestsPATCH(request, 'club');
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ADMIN CLUB REQUESTS] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
