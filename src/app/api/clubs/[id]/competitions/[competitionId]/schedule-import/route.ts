import type { NextRequest } from 'next/server';
import { competitionsOneScheduleImportRoutePOST } from '@/lib/orgs/routes/competitions-one-schedule-import';

// ── /api/clubs/[id]/competitions/[competitionId]/schedule-import — a shim (Round 5 E-2) ──
// The body is src/lib/orgs/routes/competitions-one-schedule-import.ts, one handler for both kinds;
// the gates live there (the route-authz audit follows the delegation).

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; competitionId: string }> }) {
  return competitionsOneScheduleImportRoutePOST(request, 'club', await params);
}
