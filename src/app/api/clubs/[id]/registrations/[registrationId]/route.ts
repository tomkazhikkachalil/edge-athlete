import type { NextRequest } from 'next/server';
import { registrationsItemRoutePATCH } from '@/lib/orgs/routes/registrations-item';

// ── /api/clubs/[id]/registrations/[registrationId] — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/registrations-item.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; registrationId: string }> }) {
  return registrationsItemRoutePATCH(request, 'club', await params);
}
