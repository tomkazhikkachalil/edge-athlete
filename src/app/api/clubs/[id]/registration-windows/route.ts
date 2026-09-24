import type { NextRequest } from 'next/server';
import { registrationWindowsRouteGET, registrationWindowsRoutePOST, registrationWindowsRouteDELETE } from '@/lib/orgs/routes/registration-windows';

// ── /api/clubs/[id]/registration-windows — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/registration-windows.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return registrationWindowsRouteGET(request, 'club', await params);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return registrationWindowsRoutePOST(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return registrationWindowsRouteDELETE(request, 'club', await params);
}
