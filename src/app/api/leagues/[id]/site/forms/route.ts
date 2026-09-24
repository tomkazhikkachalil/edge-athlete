import type { NextRequest } from 'next/server';
import { siteFormsRouteGET, siteFormsRoutePATCH } from '@/lib/orgs/routes/site-forms';

// ── /api/leagues/[id]/site/forms — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/site-forms.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteFormsRouteGET(request, 'league', await params);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return siteFormsRoutePATCH(request, 'league', await params);
}
