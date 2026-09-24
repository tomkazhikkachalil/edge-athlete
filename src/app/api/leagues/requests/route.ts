import { NextRequest, NextResponse } from 'next/server';
import { orgRequestsGET, orgRequestsPOST } from '@/lib/orgs/requests-server';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/leagues/requests — self-service "Start a league" ────────────────────
// A shim (Round 5 D3): the body is orgRequestsPOST / orgRequestsGET in
// src/lib/orgs/requests-server.ts, one handler for both kinds over
// `org_requests` (236) — requireActiveWriter + requireOrgCreator inside.

/** POST — submit a request. */
export async function POST(request: NextRequest) {
  try {
    return await orgRequestsPOST(request, 'league');
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE REQUESTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — the caller's own requests, newest first. */
export async function GET(request: NextRequest) {
  try {
    return await orgRequestsGET(request, 'league');
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[LEAGUE REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
