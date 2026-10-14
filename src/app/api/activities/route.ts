import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { fromWire } from '@/lib/activities/wire';
import { parseWireActivity } from '@/lib/activities/wire-schema';
import { importActivity } from '@/lib/activities/write-server';

/**
 * POST /api/activities — save the phone recorder's finished recording
 * (Live Activities, 251). `onlyMe: true` (the recorder's review) saves it
 * Only me in the same call.
 *
 * The phone sends the compact columnar payload (wire.ts, ≤ 10,000 samples,
 * `format: 'live'` — the only format since Oct 13 2026, when the .GPX /
 * .TCX file import left with the Import Activity door; a .FIT route left
 * with it). This route re-validates it (wire-schema.ts) and the writer
 * recomputes every total — nothing the client computed is trusted: source
 * 'live', external_id the recording's own id (a retry is a 200 duplicate,
 * never a second row), the segments it marked, and a step estimate from the
 * acting profile's height.
 *
 * Body: { activity: WireActivity, targetProfileId?: string, onlyMe?: true }
 * — a guardian saves for their athlete through the shared acting gate.
 * 201 { id, duplicate: false } · 200 { id, duplicate: true } · 400 / 413 /
 * 422 with the reason.
 */
const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'activity-import', { userId: user.id });
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'This activity is too large to save.' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { activity, targetProfileId, onlyMe } = (body ?? {}) as { activity?: unknown; targetProfileId?: unknown; onlyMe?: unknown };

    const gate = await resolveActingProfile(
      user.id,
      typeof targetProfileId === 'string' && targetProfileId ? targetProfileId : null,
      'Only a guardian may save activities for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const parsed = parseWireActivity(activity);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: prof } = await admin.from('profiles').select('height_cm').eq('id', gate.actorId).maybeSingle();
    const heightCm = typeof prof?.height_cm === 'number' ? prof.height_cm : null;
    const outcome = await importActivity(admin, gate.actorId, fromWire(parsed.value), {
      timeZone: parsed.value.tz,
      heightCm,
      source: 'live',
      externalId: `live:${parsed.value.recordingId}`,
      live: { segments: parsed.value.segments ?? [] },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    // The recorder's review chose Only me (Oct 9 2026): private from the
    // moment it exists — set here, not by a second call that could fail and
    // leave it on the profile. Idempotent, so a retried save (the same
    // live:<recordingId>, a duplicate) lands Only me too; never on an
    // activity that is already on the feed.
    if (onlyMe === true) {
      const { error: omErr } = await admin
        .from('activities')
        .update({ only_me: true })
        .eq('id', outcome.id)
        .eq('profile_id', gate.actorId)
        .is('post_id', null);
      if (omErr) {
        reportRouteError('[activities] only-me on save failed:', omErr);
        return NextResponse.json({ error: 'Could not save the activity as Only me. Try again.' }, { status: 500 });
      }
    }
    return NextResponse.json({ id: outcome.id, duplicate: outcome.duplicate }, { status: outcome.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities] save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
