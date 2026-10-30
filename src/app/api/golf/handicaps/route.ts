import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import { formatHandicapIndex } from '@/lib/golf/handicap';
import { parseHandicapIds } from '@/lib/golf/handicaps';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/golf/handicaps?ids=a,b,c — the computed handicap estimate for a
 * short list of players (the golf round's last step, Oct 29 2026: "Tom ·
 * index 12.4"). ≤ 8 ids; each behind `canViewProfile` for the caller; a
 * player the caller may not see, or one without enough rated rounds,
 * answers null — the list renders either way. The computation is the
 * profile card's (`fetchHandicapComputation`, read-time, never stored), run
 * with the service client AFTER the gate, as the skill card does.
 *   → { handicaps: { [profileId]: "12.4" | "+1.5" | null } }, private, no-store.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const ids = parseHandicapIds(request.nextUrl.searchParams.get('ids'));
    if (ids.length === 0) return NextResponse.json({ handicaps: {} }, { headers: NO_STORE });
    const admin = getSupabaseAdmin();
    const handicaps: Record<string, string | null> = {};
    await Promise.all(
      ids.map(async id => {
        try {
          const gate = id === user.id ? { canView: true } : await canViewProfile(id, user.id);
          if (!gate.canView) {
            handicaps[id] = null;
            return;
          }
          const result = await fetchHandicapComputation(id, admin);
          const index = result.current?.index;
          handicaps[id] = typeof index === 'number' && Number.isFinite(index) ? formatHandicapIndex(index) : null;
        } catch {
          handicaps[id] = null;
        }
      })
    );
    return NextResponse.json({ handicaps }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/golf/handicaps]', error);
    return NextResponse.json({ error: 'Could not read handicaps' }, { status: 500, headers: NO_STORE });
  }
}
