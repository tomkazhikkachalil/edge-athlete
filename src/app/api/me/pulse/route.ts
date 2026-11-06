import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import type { PulsePayload } from '@/lib/pulse/pulse-rules';

/**
 * GET /api/me/pulse — the signed-in header's numbers in ONE call (the cost
 * program PR B, Oct 29 2026; migration 292, docs/specs/pulse.md):
 *
 *   { liveNow: { golf, events, broadcasts, total }, unread: { messages } }
 *
 * `broadcasts` (migration 300, the Videos program Phase 4a): the linked
 * YouTube broadcasts streaming now that the viewer may see — the SQL mirror
 * of GET /api/videos/live-now. Ahead of 300 the key is absent and reads 0.
 *
 * It replaces three polls every visible tab made on every page —
 * `/api/golf/live-now/count` + `/api/sport-events/live-now?count=1` once a
 * minute and `/api/messages/unread-count` every two minutes — with one
 * function call and one RPC (`me_pulse`, the SQL mirror of the routes'
 * pure rules; those routes stay for the strip, the e2e parity spec and the
 * load scripts). Viewer-dependent, so `private, no-store`: never a CDN copy.
 */
type MePulseRow = { live_golf?: number; live_events?: number; live_broadcasts?: number; unread_messages?: number };

export async function GET(request: NextRequest) {
  try {
    const viewer = await requireAuth(request);
    const { data, error } = await getSupabaseAdmin().rpc('me_pulse', { p_viewer: viewer.id });
    if (error) {
      if (error.code === 'PGRST202') {
        // A deploy ahead of migration 292 on this database: say so, cache nothing.
        return NextResponse.json({ error: 'Pulse updating' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      reportRouteError('GET /api/me/pulse: rpc failed:', error);
      return NextResponse.json({ error: 'Failed to load pulse' }, { status: 500 });
    }
    const row = (data ?? {}) as MePulseRow;
    const golf = Math.max(0, Number(row.live_golf) || 0);
    const events = Math.max(0, Number(row.live_events) || 0);
    const broadcasts = Math.max(0, Number(row.live_broadcasts) || 0);
    const payload: PulsePayload = {
      liveNow: { golf, events, broadcasts, total: golf + events + broadcasts },
      unread: { messages: Math.max(0, Number(row.unread_messages) || 0) },
    };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('GET /api/me/pulse error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
