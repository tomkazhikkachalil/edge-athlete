import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { fromWire } from '@/lib/activities/wire';
import { parseWireActivity } from '@/lib/activities/wire-schema';
import { importActivity } from '@/lib/activities/write-server';

/**
 * POST /api/activities — import one .GPX / .TCX activity (Activities, 245).
 *
 * The browser parsed the file (a long ride's XML can exceed the 4.5 MB
 * request cap) and sends the compact columnar payload (wire.ts, ≤ 10,000
 * samples). This route re-validates it (wire-schema.ts) and the writer
 * recomputes every total — nothing the client computed is trusted. A .FIT
 * goes to /api/activities/fit instead (decoded on the server).
 *
 * Body: { activity: WireActivity, targetProfileId?: string } — a guardian
 * imports for their athlete through the shared acting gate.
 * 201 { id, duplicate: false } · 200 { id, duplicate: true } (a re-import
 * refreshed the existing activity) · 400 / 413 / 422 with the reason.
 *
 * `format: 'live'` (Live Activities, 251) is the phone recorder's finished
 * recording through the SAME door: source 'live', external_id the
 * recording's own id (a retry is a 200 duplicate, never a second row), the
 * segments it marked, and a step estimate from the acting profile's height.
 */
const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'activity-import', { userId: user.id });
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'This activity is too large to import.' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { activity, targetProfileId } = (body ?? {}) as { activity?: unknown; targetProfileId?: unknown };

    const gate = await resolveActingProfile(
      user.id,
      typeof targetProfileId === 'string' && targetProfileId ? targetProfileId : null,
      'Only a guardian may import activities for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const parsed = parseWireActivity(activity);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: prof } = await admin.from('profiles').select('height_cm').eq('id', gate.actorId).maybeSingle();
    const heightCm = typeof prof?.height_cm === 'number' ? prof.height_cm : null;
    const live = parsed.value.format === 'live';
    const outcome = await importActivity(admin, gate.actorId, fromWire(parsed.value), {
      timeZone: parsed.value.tz,
      heightCm,
      ...(live
        ? { source: 'live' as const, externalId: `live:${parsed.value.recordingId}`, live: { segments: parsed.value.segments ?? [] } }
        : {}),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ id: outcome.id, duplicate: outcome.duplicate }, { status: outcome.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities] import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
