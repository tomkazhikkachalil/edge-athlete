import type { NextRequest } from 'next/server';
import { venuesItemRoutePATCH, venuesItemRouteDELETE } from '@/lib/orgs/routes/venues-item';

// ── /api/clubs/[id]/venues/[venueId] — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/venues-item.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; venueId: string }> }) {
  return venuesItemRoutePATCH(request, 'club', await params);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; venueId: string }> }) {
  return venuesItemRouteDELETE(request, 'club', await params);
}
