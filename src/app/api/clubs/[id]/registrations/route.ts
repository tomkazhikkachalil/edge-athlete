import type { NextRequest } from 'next/server';
import { registrationsRoutePOST, registrationsRouteGET } from '@/lib/orgs/routes/registrations';

// ── /api/clubs/[id]/registrations — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/registrations.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return registrationsRoutePOST(request, 'club', await params);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return registrationsRouteGET(request, 'club', await params);
}
